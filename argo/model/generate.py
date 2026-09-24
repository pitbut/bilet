"""
Генерация текста обученным Арго.

  python generate.py --model арго/argo.pt --prompt "Однажды вечером"
  python generate.py --model арго/argo.pt              # без --prompt — режим диалога
"""

import argparse

import torch

from model import load_checkpoint, pick_device
from tokenizer import clean, decode, encode


def main():
    ap = argparse.ArgumentParser(description="Генерация текста Арго")
    ap.add_argument("--model", default="арго/argo.pt")
    ap.add_argument("--prompt", default=None, help="начало текста")
    ap.add_argument("--length", type=int, default=500, help="сколько символов написать")
    ap.add_argument("--temperature", type=float, default=0.8, help="0.5 — осторожно, 1.2 — смело")
    args = ap.parse_args()

    device = pick_device()
    model, ckpt = load_checkpoint(args.model, device)
    model.eval()
    print(f"🧠 Арго загружен (шаг обучения {ckpt['step']}, {model.num_params() / 1e6:.2f} млн весов)")

    def write(prompt):
        start = torch.tensor([encode(clean(prompt) or "\n")], dtype=torch.long, device=device)
        return decode(model.generate(start, args.length, temperature=args.temperature)[0].tolist())

    if args.prompt is not None:
        print(write(args.prompt))
        return

    print("Пишите начало текста, Арго продолжит. Пустая строка — выход.\n")
    while True:
        prompt = input("Вы: ")
        if not prompt.strip():
            break
        print(f"Арго: {write(prompt)}\n")


if __name__ == "__main__":
    main()
