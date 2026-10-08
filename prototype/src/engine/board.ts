// Поле «Олигарха»: 40 клеток, цены в млн ₽ (см. дизайн-документ, раздел «Игровое поле»).

export type IndustryId = "agro" | "forest" | "metal" | "auto" | "tourism" | "gas" | "oil" | "finance";
export type BranchId = "rent" | "income" | "special";

export type CellKind =
  | "start" | "business" | "transport" | "energy" | "news" | "gov"
  | "tax" | "casino" | "forum" | "zagul";

export interface Cell {
  index: number;
  name: string;
  kind: CellKind;
  industry?: IndustryId;
  price?: number;
  baseRent?: number;
  tax?: "profit" | "luxury";
  model?: string; // id модели для клеток, которые не застраиваются
}

export const INDUSTRIES: Record<IndustryId, { name: string; color: string; branches: Record<BranchId, string> }> = {
  agro: { name: "Агро", color: "#c9a227", branches: { rent: "Ферма → Агрохолдинг", income: "Элеватор", special: "Экспорт зерна" } },
  forest: { name: "Лес и бумага", color: "#3f8a3c", branches: { rent: "Лесопилка → ЦБК", income: "Мебельная фабрика", special: "Стройматериалы" } },
  metal: { name: "Металлургия", color: "#7d7d78", branches: { rent: "Литейный цех → Меткомбинат", income: "Прокатный стан", special: "Поставщик стали" } },
  auto: { name: "Автопром", color: "#cf3a33", branches: { rent: "Автозавод → Конвейер", income: "Дилерская сеть", special: "Тест-драйв" } },
  tourism: { name: "Туризм", color: "#2aa198", branches: { rent: "Отель → Курорт", income: "Санаторий", special: "Аквапарк" } },
  gas: { name: "Газ", color: "#2f6fc2", branches: { rent: "Скважина → Газовый промысел", income: "Газопровод", special: "СПГ-завод" } },
  oil: { name: "Нефть", color: "#2b2c31", branches: { rent: "Буровая → Нефтекачалка", income: "НПЗ", special: "Нефтепровод" } },
  finance: { name: "Финансы и IT", color: "#7a4bb8", branches: { rent: "Бизнес-центр → Небоскрёб", income: "Банк", special: "IT-хаб" } },
};

export const BRANCH_EFFECTS: Record<IndustryId, string> = {
  agro: "Экспорт зерна: +20 за раунд за каждый ваш порт",
  forest: "Стройматериалы: все ваши стройки дешевле на 15%",
  metal: "Поставщик стали: 5% от стоимости каждой чужой стройки",
  auto: "Тест-драйв: пока без эффекта в прототипе",
  tourism: "Аквапарк: гость пропускает следующий ход",
  gas: "СПГ-завод: доход 8% цены за раунд, ×2 при наличии порта",
  oil: "Нефтепровод: +25% аренды за каждую другую вашу нефтяную клетку",
  finance: "IT-хаб: все ваши стройки идут на 20% быстрее",
};

const b = (index: number, name: string, industry: IndustryId, price: number, baseRent: number): Cell =>
  ({ index, name, kind: "business", industry, price, baseRent });

export const BOARD: Cell[] = [
  { index: 0, name: "Старт", kind: "start", model: "corners/start" },
  b(1, "Краснодар", "agro", 60, 4),
  { index: 2, name: "Госзаказ", kind: "gov" },
  b(3, "Ставрополь", "agro", 60, 4),
  { index: 4, name: "Налог на прибыль", kind: "tax", tax: "profit" },
  { index: 5, name: "Транссиб", kind: "transport", price: 200, baseRent: 25, model: "tiles/transsib" },
  b(6, "Архангельск", "forest", 100, 6),
  { index: 7, name: "Новости", kind: "news" },
  b(8, "Сыктывкар", "forest", 100, 6),
  b(9, "Петрозаводск", "forest", 120, 8),
  { index: 10, name: "Казино", kind: "casino", model: "corners/casino" },
  b(11, "Магнитогорск", "metal", 140, 10),
  { index: 12, name: "ГЭС на Енисее", kind: "energy", price: 150, model: "tiles/hydro" },
  b(13, "Челябинск", "metal", 140, 10),
  b(14, "Липецк", "metal", 160, 12),
  { index: 15, name: "Порт Новороссийск", kind: "transport", price: 200, baseRent: 25, model: "tiles/port_novorossiysk" },
  b(16, "Тольятти", "auto", 180, 14),
  { index: 17, name: "Госзаказ", kind: "gov" },
  b(18, "Набережные Челны", "auto", 180, 14),
  b(19, "Нижний Новгород", "auto", 200, 16),
  { index: 20, name: "Экономический форум", kind: "forum", model: "corners/forum" },
  b(21, "Сочи", "tourism", 220, 18),
  { index: 22, name: "Новости", kind: "news" },
  b(23, "Калининград", "tourism", 220, 18),
  b(24, "Иркутск (Байкал)", "tourism", 240, 20),
  { index: 25, name: "Аэропорт Шереметьево", kind: "transport", price: 200, baseRent: 25, model: "tiles/airport_sheremetyevo" },
  b(26, "Новый Уренгой", "gas", 260, 22),
  b(27, "Ямал", "gas", 260, 22),
  { index: 28, name: "АЭС", kind: "energy", price: 150, model: "tiles/nuclear" },
  b(29, "Оренбург", "gas", 280, 24),
  { index: 30, name: "Загул", kind: "zagul", model: "corners/zagul" },
  b(31, "Сургут", "oil", 300, 26),
  b(32, "Нижневартовск", "oil", 300, 26),
  { index: 33, name: "Госзаказ", kind: "gov" },
  b(34, "Альметьевск", "oil", 320, 28),
  { index: 35, name: "Порт Владивосток", kind: "transport", price: 200, baseRent: 25, model: "tiles/port_vladivostok" },
  { index: 36, name: "Новости", kind: "news" },
  b(37, "Санкт-Петербург", "finance", 350, 35),
  { index: 38, name: "Налог на роскошь", kind: "tax", tax: "luxury" },
  b(39, "Москва", "finance", 400, 50),
];

export const CASINO_INDEX = 10;
export const PORT_INDICES = [15, 35];

export const industryCells = (id: IndustryId) => BOARD.filter((c) => c.industry === id).map((c) => c.index);
