"""
Модель Арго — маленький трансформер (та же архитектура, что у GPT).

Как читать этот файл:
  1. ArgoConfig  — «чертёж»: сколько слоёв, насколько большая модель.
  2. Attention   — «внимание»: каждая буква смотрит на предыдущие и решает,
                   какие из них важны (например, «он» -> кто это был раньше?).
  3. MLP         — «размышление»: обработка того, что собрало внимание.
  4. Block       — один слой = внимание + размышление.
  5. Argo        — вся модель: превращает буквы в векторы, пропускает
                   через слои и выдаёт вероятности следующей буквы.

ВСЕ «знания» модели хранятся в весах — это просто большие таблицы чисел
(nn.Linear, nn.Embedding). В начале они случайные, поэтому модель пишет
мусор. Обучение = понемногу подкручивать эти числа, чтобы модель
чаще угадывала следующую букву.
"""

from dataclasses import dataclass

import torch
import torch.nn as nn
import torch.nn.functional as F


@dataclass
class ArgoConfig:
    vocab_size: int = 128   # сколько разных символов знает модель
    block_size: int = 256   # сколько предыдущих символов модель «видит» сразу (её память)
    n_layer: int = 6        # сколько слоёв (глубина «мышления»)
    n_head: int = 6         # сколько «голов внимания» в каждом слое
    n_embd: int = 384       # размер вектора, которым описывается каждая буква
    dropout: float = 0.2    # доля случайно отключаемых связей при обучении (против зубрёжки)


# Готовые размеры модели.
PRESETS = {
    # Для обычного компьютера без видеокарты: ~0.8 млн весов, учится за минуты.
    "малыш": dict(block_size=128, n_layer=4, n_head=4, n_embd=128, dropout=0.1),
    # Для бесплатной видеокарты Kaggle/Colab: ~10.8 млн весов.
    "средний": dict(block_size=256, n_layer=6, n_head=6, n_embd=384, dropout=0.2),
    # Для видеокарты и большого объёма текста (много книг): ~42 млн весов.
    "большой": dict(block_size=512, n_layer=8, n_head=8, n_embd=640, dropout=0.1),
}


class Attention(nn.Module):
    """Внимание: каждая позиция собирает информацию с предыдущих позиций."""

    def __init__(self, cfg: ArgoConfig):
        super().__init__()
        self.n_head = cfg.n_head
        # Одним слоем сразу считаем «вопрос» (q), «ключ» (k) и «значение» (v).
        self.qkv = nn.Linear(cfg.n_embd, 3 * cfg.n_embd)
        self.proj = nn.Linear(cfg.n_embd, cfg.n_embd)
        self.dropout = cfg.dropout
        self.resid_drop = nn.Dropout(cfg.dropout)

    def forward(self, x):
        B, T, C = x.shape  # B — сколько кусков текста, T — длина куска, C — размер вектора
        q, k, v = self.qkv(x).split(C, dim=2)
        # Делим на несколько «голов»: каждая следит за своим (грамматика, смысл, рифма...).
        q = q.view(B, T, self.n_head, C // self.n_head).transpose(1, 2)
        k = k.view(B, T, self.n_head, C // self.n_head).transpose(1, 2)
        v = v.view(B, T, self.n_head, C // self.n_head).transpose(1, 2)
        # is_causal=True — буква видит только то, что было ДО неё (подглядывать в будущее нельзя).
        y = F.scaled_dot_product_attention(
            q, k, v, is_causal=True, dropout_p=self.dropout if self.training else 0.0
        )
        y = y.transpose(1, 2).contiguous().view(B, T, C)
        return self.resid_drop(self.proj(y))


class MLP(nn.Module):
    """Размышление: обработка каждой позиции отдельно."""

    def __init__(self, cfg: ArgoConfig):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(cfg.n_embd, 4 * cfg.n_embd),
            nn.GELU(),
            nn.Linear(4 * cfg.n_embd, cfg.n_embd),
            nn.Dropout(cfg.dropout),
        )

    def forward(self, x):
        return self.net(x)


class Block(nn.Module):
    """Один слой трансформера."""

    def __init__(self, cfg: ArgoConfig):
        super().__init__()
        self.ln1 = nn.LayerNorm(cfg.n_embd)
        self.attn = Attention(cfg)
        self.ln2 = nn.LayerNorm(cfg.n_embd)
        self.mlp = MLP(cfg)

    def forward(self, x):
        # «x + ...» — слой не заменяет информацию, а ДОБАВЛЯЕТ к ней своё.
        x = x + self.attn(self.ln1(x))
        x = x + self.mlp(self.ln2(x))
        return x


class Argo(nn.Module):
    def __init__(self, cfg: ArgoConfig):
        super().__init__()
        self.cfg = cfg
        self.tok_emb = nn.Embedding(cfg.vocab_size, cfg.n_embd)  # буква -> вектор
        self.pos_emb = nn.Embedding(cfg.block_size, cfg.n_embd)  # позиция -> вектор
        self.drop = nn.Dropout(cfg.dropout)
        self.blocks = nn.ModuleList([Block(cfg) for _ in range(cfg.n_layer)])
        self.ln_f = nn.LayerNorm(cfg.n_embd)
        self.head = nn.Linear(cfg.n_embd, cfg.vocab_size, bias=False)  # вектор -> оценка каждой буквы
        self.head.weight = self.tok_emb.weight  # общие веса на входе и выходе (экономия)
        self.apply(self._init_weights)

    @staticmethod
    def _init_weights(m):
        # Начальные веса — маленькие случайные числа. Модель «рождается» ничего не зная.
        if isinstance(m, (nn.Linear, nn.Embedding)):
            nn.init.normal_(m.weight, mean=0.0, std=0.02)
        if isinstance(m, nn.Linear) and m.bias is not None:
            nn.init.zeros_(m.bias)

    def num_params(self) -> int:
        return sum(p.numel() for p in self.parameters()) - self.pos_emb.weight.numel()

    def forward(self, idx, targets=None):
        B, T = idx.shape
        pos = torch.arange(T, device=idx.device)
        x = self.drop(self.tok_emb(idx) + self.pos_emb(pos))
        for block in self.blocks:
            x = block(x)
        logits = self.head(self.ln_f(x))  # для каждой позиции: оценки всех возможных следующих букв

        loss = None
        if targets is not None:
            # ОШИБКА (loss): насколько модель удивилась правильной следующей букве.
            # Чем меньше — тем лучше модель предсказывает текст.
            loss = F.cross_entropy(logits.view(-1, logits.size(-1)), targets.view(-1))
        return logits, loss

    @torch.no_grad()
    def generate(self, idx, max_new_tokens: int, temperature: float = 0.8, top_k: int | None = 20):
        """Пишет текст: предсказывает букву, добавляет её, предсказывает следующую..."""
        for _ in range(max_new_tokens):
            idx_cond = idx[:, -self.cfg.block_size:]  # модель видит только последние block_size букв
            logits, _ = self(idx_cond)
            # temperature: <1 — осторожнее и скучнее, >1 — смелее и безумнее.
            logits = logits[:, -1, :] / max(temperature, 1e-5)
            if top_k is not None:
                v, _ = torch.topk(logits, min(top_k, logits.size(-1)))
                logits[logits < v[:, [-1]]] = -float("inf")
            probs = F.softmax(logits, dim=-1)
            next_id = torch.multinomial(probs, num_samples=1)  # выбираем букву с учётом вероятностей
            idx = torch.cat((idx, next_id), dim=1)
        return idx


def save_checkpoint(path, model: Argo, optimizer, step: int, history: list):
    torch.save(
        {
            "config": model.cfg.__dict__,
            "model": model.state_dict(),
            "optimizer": optimizer.state_dict() if optimizer else None,
            "step": step,
            "history": history,
        },
        path,
    )


def load_checkpoint(path, device="cpu"):
    ckpt = torch.load(path, map_location=device, weights_only=False)
    model = Argo(ArgoConfig(**ckpt["config"])).to(device)
    model.load_state_dict(ckpt["model"])
    return model, ckpt


def pick_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


__all__ = ["ArgoConfig", "Argo", "PRESETS", "save_checkpoint", "load_checkpoint", "pick_device"]
