"""
Токенизатор Арго — переводит текст в числа и обратно.

Нейросеть не умеет читать буквы, она работает только с числами.
Поэтому каждой букве мы даём номер:  'а' -> 1, 'б' -> 2, ...

Мы используем ПОСИМВОЛЬНЫЙ токенизатор (одна буква = один токен).
Это самый простой и наглядный вариант: модель учится писать буква за буквой.

Алфавит фиксированный, поэтому можно обучить Арго на одной книге,
а потом дообучить на другой — номера букв не поменяются.
"""

RUSSIAN = "абвгдеёжзийклмнопрстуфхцчшщъыьэюя"
ENGLISH = "abcdefghijklmnopqrstuvwxyz"
DIGITS = "0123456789"
OLD_RUSSIAN = "іѣѳѵ"  # дореформенные буквы — встречаются в старых книгах
PUNCT = " \n.,!?;:-—–()\"'«»…/%№*+=<>[]"

# Индекс 0 зарезервирован для «неизвестного символа».
UNKNOWN = "�"
ALPHABET = UNKNOWN + RUSSIAN + RUSSIAN.upper() + ENGLISH + ENGLISH.upper() + OLD_RUSSIAN + OLD_RUSSIAN.upper() + DIGITS + PUNCT

_char_to_id = {ch: i for i, ch in enumerate(ALPHABET)}
_id_to_char = {i: ch for i, ch in enumerate(ALPHABET)}

VOCAB_SIZE = len(ALPHABET)


def clean(text: str) -> str:
    """Приводит текст к виду, который понимает Арго."""
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\t", " ")
    # Символы, которых нет в алфавите, просто выбрасываем.
    return "".join(ch for ch in text if ch in _char_to_id and ch != UNKNOWN)


def encode(text: str) -> list[int]:
    """Текст -> список чисел."""
    return [_char_to_id.get(ch, 0) for ch in text]


def decode(ids) -> str:
    """Список чисел -> текст."""
    return "".join(_id_to_char.get(int(i), UNKNOWN) for i in ids)
