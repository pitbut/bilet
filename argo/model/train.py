"""
Обучение Арго.

Примеры:
  # Обучить с нуля на книге (маленькая модель, хватит обычного компьютера)
  python train.py --books моя_книга.txt --preset малыш

  # Обучить на всех .txt из папки, модель побольше (для видеокарты Kaggle/Colab)
  python train.py --books книги/ --preset средний --steps 5000

  # Дообучить уже обученного Арго на новой книге
  python train.py --books новая_книга.txt --resume арго/argo.pt --steps 1000

Что происходит при обучении (один «шаг»):
  1. Берём из книги случайные куски текста.
  2. Модель для каждой буквы пытается угадать следующую.
  3. Считаем ОШИБКУ — насколько она промахнулась.
  4. Считаем, в какую сторону подвинуть КАЖДЫЙ вес, чтобы ошибка стала меньше
     (это называется «градиент», считается автоматически: loss.backward()).
  5. Чуть-чуть двигаем все веса в эту сторону (optimizer.step()).
  Повторяем тысячи раз — и из случайных чисел получается модель, пишущая текст.
"""

import argparse
import json
import math
import time
from pathlib import Path

import torch

from model import PRESETS, Argo, ArgoConfig, load_checkpoint, pick_device, save_checkpoint
from tokenizer import VOCAB_SIZE, clean, decode, encode


def read_text(path: Path) -> str:
    raw = path.read_bytes()
    for enc in ("utf-8", "cp1251"):  # книги на русском часто бывают в кодировке Windows
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="ignore")


def load_books(source: str) -> str:
    p = Path(source)
    files = sorted(p.rglob("*.txt")) if p.is_dir() else [p]
    if not files:
        raise SystemExit(f"Не нашёл .txt файлов в {source}")
    texts = []
    for f in files:
        t = clean(read_text(f))
        print(f"  📖 {f.name}: {len(t):,} символов")
        texts.append(t)
    return "\n\n".join(texts)


def main():
    ap = argparse.ArgumentParser(description="Обучение модели Арго")
    ap.add_argument("--books", required=True, help="файл .txt или папка с .txt")
    ap.add_argument("--preset", default="малыш", choices=list(PRESETS), help="размер модели")
    ap.add_argument("--steps", type=int, default=2000, help="сколько шагов обучения")
    ap.add_argument("--batch", type=int, default=32, help="сколько кусков текста за один шаг")
    ap.add_argument("--lr", type=float, default=1e-3, help="скорость обучения (размер шага)")
    ap.add_argument("--eval-every", type=int, default=200, help="как часто проверять и показывать пример")
    ap.add_argument("--out", default="арго", help="папка для сохранения модели")
    ap.add_argument("--resume", default=None, help="путь к argo.pt, чтобы дообучить")
    ap.add_argument("--prompt", default="\n", help="с чего начинать пример текста")
    args = ap.parse_args()

    device = pick_device()
    torch.manual_seed(1337)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    print("📚 Читаю книги...")
    data = torch.tensor(encode(load_books(args.books)), dtype=torch.long)
    split = int(0.9 * len(data))
    # 90% текста — для обучения, 10% — «экзамен» (модель их не учит, только проверяется на них).
    train_data, val_data = data[:split], data[split:]

    history = []
    start_step = 0
    if args.resume:
        model, ckpt = load_checkpoint(args.resume, device)
        history = ckpt.get("history", [])
        start_step = ckpt.get("step", 0)
        print(f"🔁 Продолжаю обучение с шага {start_step}")
    else:
        cfg = ArgoConfig(vocab_size=VOCAB_SIZE, **PRESETS[args.preset])
        model = Argo(cfg).to(device)

    cfg = model.cfg
    if len(val_data) <= cfg.block_size + 1:
        raise SystemExit("Текста слишком мало. Нужно хотя бы несколько тысяч символов.")

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.1, betas=(0.9, 0.99))
    if args.resume and ckpt.get("optimizer"):
        optimizer.load_state_dict(ckpt["optimizer"])
        for g in optimizer.param_groups:
            g["lr"] = args.lr

    use_amp = device == "cuda"
    scaler = torch.amp.GradScaler("cuda", enabled=use_amp)

    print(f"🧠 Устройство: {device}")
    print(f"🧠 Размер модели: {model.num_params() / 1e6:.2f} млн весов (чисел, которые будут меняться)")
    print(f"📚 Текст для обучения: {len(train_data):,} символов, для проверки: {len(val_data):,}")
    print(f"🎲 Модель «рождается» случайной — первые примеры будут мусором.\n")

    def get_batch(split_data):
        ix = torch.randint(len(split_data) - cfg.block_size - 1, (args.batch,))
        x = torch.stack([split_data[i : i + cfg.block_size] for i in ix])
        # y — это тот же текст, сдвинутый на одну букву: правильные ответы «какая буква следующая».
        y = torch.stack([split_data[i + 1 : i + 1 + cfg.block_size] for i in ix])
        return x.to(device), y.to(device)

    @torch.no_grad()
    def estimate_loss(iters=50):
        model.eval()
        res = {}
        for name, d in (("обучение", train_data), ("проверка", val_data)):
            losses = torch.zeros(iters)
            for k in range(iters):
                x, y = get_batch(d)
                with torch.autocast(device_type=device, dtype=torch.float16, enabled=use_amp):
                    _, loss = model(x, y)
                losses[k] = loss.item()
            res[name] = losses.mean().item()
        model.train()
        return res

    def sample(n=300):
        model.eval()
        start = torch.tensor([encode(clean(args.prompt) or "\n")], dtype=torch.long, device=device)
        text = decode(model.generate(start, n)[0].tolist())
        model.train()
        return text

    # Скорость обучения: плавный разгон, потом плавное снижение (так учится стабильнее).
    warmup = min(100, args.steps // 10)

    def lr_at(i):
        if i < warmup:
            return args.lr * (i + 1) / warmup
        progress = (i - warmup) / max(1, args.steps - warmup)
        return args.lr * (0.1 + 0.9 * 0.5 * (1 + math.cos(math.pi * progress)))

    diary = open(out / "дневник_обучения.txt", "a", encoding="utf-8")
    best_val = float("inf")
    t0 = time.time()

    for i in range(args.steps + 1):
        step = start_step + i
        if i % args.eval_every == 0 or i == args.steps:
            losses = estimate_loss()
            val = losses["проверка"]
            # exp(ошибки) — примерно «между сколькими буквами модель сомневается».
            doubt = math.exp(val)
            text = sample()
            report = (
                f"\n{'=' * 60}\n"
                f"Шаг {step} | ошибка на обучении {losses['обучение']:.3f} | "
                f"на проверке {val:.3f} | сомневается между ~{doubt:.1f} буквами | "
                f"{time.time() - t0:.0f} сек\n"
                f"{'-' * 60}\n{text}\n"
            )
            print(report, flush=True)
            diary.write(report)
            diary.flush()
            history.append({"step": step, "train": losses["обучение"], "val": val})
            if val < best_val:
                best_val = val
                save_checkpoint(out / "argo.pt", model, optimizer, step, history)
                print(f"💾 Сохранил лучшую версию Арго в {out / 'argo.pt'}")
            if losses["обучение"] < val - 0.3:
                print("⚠️  Ошибка на обучении сильно ниже, чем на проверке — модель начинает "
                      "ЗУБРИТЬ книгу. Нужно больше текста или меньше шагов.")
        if i == args.steps:
            break

        for g in optimizer.param_groups:
            g["lr"] = lr_at(i)
        x, y = get_batch(train_data)
        with torch.autocast(device_type=device, dtype=torch.float16, enabled=use_amp):
            _, loss = model(x, y)           # 2–3. угадываем и считаем ошибку
        optimizer.zero_grad(set_to_none=True)
        scaler.scale(loss).backward()        # 4. считаем, куда двигать каждый вес
        scaler.unscale_(optimizer)
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        scaler.step(optimizer)               # 5. двигаем веса
        scaler.update()

    diary.close()
    (out / "история.json").write_text(json.dumps(history, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n✅ Готово. Лучшая ошибка на проверке: {best_val:.3f}")
    print(f"   Поговорить с Арго: python generate.py --model {out / 'argo.pt'} --prompt \"Начало фразы\"")


if __name__ == "__main__":
    main()
