// Каталог элементов вала: типы, поля, значения по умолчанию.
// Поле: { k, label, type: 'num'|'int'|'sel'|'bool'|'text'|'fit'|'ra', def, opts, show(p) }

export const RA_LIST = ['', '0,2', '0,4', '0,8', '1,6', '3,2', '6,3', '12,5', '25'];
export const SHAFT_FITS = ['', 'h5', 'h6', 'h7', 'h8', 'h9', 'h11', 'h12', 'h14', 'js6', 'js7', 'k5', 'k6', 'm6', 'n6', 'p6', 'r6', 's6', 'g6', 'f7', 'f8', 'e8', 'e9', 'd9', 'd11'];
export const HOLE_FITS = ['', 'H6', 'H7', 'H8', 'H9', 'H11', 'H12', 'H14', 'JS7', 'JS9', 'K7', 'M7', 'N7', 'N9', 'P9', 'G7', 'F8', 'E9', 'D10'];

const chamferFields = [
  { k: 'chL', label: 'Фаска слева, мм', type: 'num', def: 0 },
  { k: 'chR', label: 'Фаска справа, мм', type: 'num', def: 0 },
  { k: 'chA', label: 'Угол фаски', type: 'sel', def: '45', opts: ['45', '30', '15', '60'] },
  { k: 'fL', label: 'Галтель слева R', type: 'num', def: 0 },
  { k: 'fR', label: 'Галтель справа R', type: 'num', def: 0 },
];
const commonOuter = [
  { k: 'ra', label: 'Шероховатость Ra', type: 'ra', def: '' },
  { k: 'noLen', label: 'Не ставить размер длины', type: 'bool', def: false },
];
const fitField = { k: 'fit', label: 'Допуск (поле)', type: 'fit', fits: SHAFT_FITS, def: '' };
const holeFitField = { k: 'fit', label: 'Допуск (поле)', type: 'fit', fits: HOLE_FITS, def: '' };
const precision = { k: 'prec', label: 'Степень точности', type: 'text', def: '8-B' };

export const OUTER = {
  cyl: {
    label: 'Цилиндр', icon: '▭', fields: [
      { k: 'D', label: 'Диаметр D', type: 'num', def: 40 },
      { k: 'L', label: 'Длина L', type: 'num', def: 50 },
      fitField, ...chamferFields, ...commonOuter],
  },
  cone: {
    label: 'Конус', icon: '⏢', fields: [
      { k: 'D', label: 'Диаметр слева D1', type: 'num', def: 40 },
      { k: 'D2', label: 'Диаметр справа D2', type: 'num', def: 30 },
      { k: 'L', label: 'Длина L', type: 'num', def: 40 },
      { k: 'showK', label: 'Указать конусность', type: 'bool', def: true },
      ...chamferFields, ...commonOuter],
  },
  hex: {
    label: 'Шестигранник', icon: '⬡', fields: [
      { k: 'S', label: 'Размер под ключ S', type: 'num', def: 27 },
      { k: 'L', label: 'Длина L', type: 'num', def: 20 },
      { k: 'orient', label: 'К зрителю', type: 'sel', def: 'грань', opts: ['грань', 'ребро'] },
      ...chamferFields, ...commonOuter],
  },
  square: {
    label: 'Квадрат', icon: '◻', fields: [
      { k: 'S', label: 'Сторона квадрата S', type: 'num', def: 22 },
      { k: 'L', label: 'Длина L', type: 'num', def: 20 },
      ...chamferFields, ...commonOuter],
  },
  thread: {
    label: 'Резьба наружная', icon: '⫼', fields: [
      { k: 'D', label: 'Номинальный диаметр d', type: 'num', def: 24 },
      { k: 'P', label: 'Шаг P', type: 'num', def: 1.5 },
      { k: 'L', label: 'Длина ступени L', type: 'num', def: 30 },
      { k: 'Lt', label: 'Длина резьбы (0 = вся)', type: 'num', def: 0 },
      { k: 'from', label: 'Резьба от торца', type: 'sel', def: 'слева', opts: ['слева', 'справа'] },
      { k: 'tol', label: 'Поле допуска', type: 'text', def: '6g' },
      { k: 'lh', label: 'Левая резьба', type: 'bool', def: false },
      ...chamferFields, ...commonOuter],
  },
  spline: {
    label: 'Шлицы', icon: '✱', fields: [
      { k: 'kind', label: 'Вид', type: 'sel', def: 'прямобочные', opts: ['прямобочные', 'эвольвентные'] },
      { k: 'z', label: 'Число зубьев z', type: 'int', def: 8 },
      { k: 'd', label: 'Внутренний d', type: 'num', def: 36, show: p => p.kind === 'прямобочные' },
      { k: 'D', label: 'Наружный D', type: 'num', def: 40 },
      { k: 'b', label: 'Ширина зуба b', type: 'num', def: 7, show: p => p.kind === 'прямобочные' },
      { k: 'm', label: 'Модуль m', type: 'num', def: 2, show: p => p.kind === 'эвольвентные' },
      { k: 'L', label: 'Длина L', type: 'num', def: 50 },
      { k: 'center', label: 'Центрирование', type: 'sel', def: 'd', opts: ['d', 'D', 'b'] },
      { k: 'des', label: 'Обозначение (пусто = авто)', type: 'text', def: '' },
      ...chamferFields, ...commonOuter],
  },
  spur: {
    label: 'Шестерня цилиндрическая', icon: '⚙', gear: true, fields: [
      { k: 'm', label: 'Модуль m', type: 'num', def: 2.5 },
      { k: 'z', label: 'Число зубьев z', type: 'int', def: 20 },
      { k: 'beta', label: 'Угол наклона β, °', type: 'num', def: 0 },
      { k: 'dir', label: 'Направление зуба', type: 'sel', def: 'прямой', opts: ['прямой', 'правое', 'левое'] },
      { k: 'x', label: 'Коэф. смещения x', type: 'num', def: 0 },
      { k: 'L', label: 'Ширина венца b', type: 'num', def: 30 },
      precision,
      ...chamferFields, ...commonOuter],
  },
  bevel: {
    label: 'Шестерня коническая', icon: '⚙', gear: true, fields: [
      { k: 'm', label: 'Внешний окружной модуль me', type: 'num', def: 3 },
      { k: 'z', label: 'Число зубьев z', type: 'int', def: 20 },
      { k: 'delta', label: 'Угол делит. конуса δ, °', type: 'num', def: 45 },
      { k: 'L', label: 'Ширина венца b', type: 'num', def: 20 },
      { k: 'big', label: 'Большой торец', type: 'sel', def: 'слева', opts: ['слева', 'справа'] },
      precision,
      ...commonOuter],
  },
  wormwheel: {
    label: 'Колесо червячное', icon: '⚙', gear: true, fields: [
      { k: 'm', label: 'Модуль m', type: 'num', def: 4 },
      { k: 'z', label: 'Число зубьев z2', type: 'int', def: 40 },
      { k: 'z1', label: 'Число витков червяка z1', type: 'int', def: 2 },
      { k: 'q', label: 'Коэф. диаметра червяка q', type: 'num', def: 10 },
      { k: 'x', label: 'Коэф. смещения x', type: 'num', def: 0 },
      { k: 'L', label: 'Ширина венца b', type: 'num', def: 36 },
      precision,
      ...commonOuter],
  },
  worm: {
    label: 'Червяк', icon: '🌀', gear: true, fields: [
      { k: 'm', label: 'Модуль m', type: 'num', def: 4 },
      { k: 'z1', label: 'Число витков z1', type: 'int', def: 2 },
      { k: 'q', label: 'Коэф. диаметра q', type: 'num', def: 10 },
      { k: 'wtype', label: 'Вид червяка', type: 'sel', def: 'ZA', opts: ['ZA', 'ZI', 'ZN', 'ZK'] },
      { k: 'dir', label: 'Направление витка', type: 'sel', def: 'правое', opts: ['правое', 'левое'] },
      { k: 'L', label: 'Длина нарезки b1', type: 'num', def: 60 },
      precision,
      ...chamferFields, ...commonOuter],
  },
  sprocket: {
    label: 'Звёздочка', icon: '✺', gear: true, fields: [
      { k: 't', label: 'Шаг цепи t', type: 'num', def: 19.05 },
      { k: 'z', label: 'Число зубьев z', type: 'int', def: 17 },
      { k: 'd1', label: 'Диаметр ролика d1', type: 'num', def: 11.91 },
      { k: 'L', label: 'Ширина зуба b', type: 'num', def: 11 },
      { k: 'chain', label: 'Цепь', type: 'text', def: 'ПР-19,05-31,8' },
      precision,
      ...chamferFields, ...commonOuter],
  },
  vpulley: {
    label: 'Шкив клиноремённый', icon: '⊜', fields: [
      { k: 'prof', label: 'Профиль ремня', type: 'sel', def: 'A', opts: ['Z', 'A', 'B', 'C', 'SPZ', 'SPA', 'SPB'] },
      { k: 'n', label: 'Число канавок', type: 'int', def: 3 },
      { k: 'dp', label: 'Расчётный диаметр dp', type: 'num', def: 125 },
      { k: 'ang', label: 'Угол канавки, °', type: 'sel', def: '36', opts: ['34', '36', '38', '40'] },
      { k: 'L', label: 'Ширина обода (0 = авто)', type: 'num', def: 0 },
      ...commonOuter],
  },
  tpulley: {
    label: 'Шкив зубчатоременный', icon: '⊛', gear: true, fields: [
      { k: 'm', label: 'Модуль ремня m', type: 'num', def: 3 },
      { k: 'z', label: 'Число зубьев z', type: 'int', def: 20 },
      { k: 'h', label: 'Высота зуба h', type: 'num', def: 2 },
      { k: 'delta', label: 'Смещение δ', type: 'num', def: 0.6 },
      { k: 'L', label: 'Ширина B', type: 'num', def: 25 },
      ...chamferFields, ...commonOuter],
  },
  fpulley: {
    label: 'Шкив плоскоремённый', icon: '▤', fields: [
      { k: 'D', label: 'Диаметр D', type: 'num', def: 160 },
      { k: 'L', label: 'Ширина B', type: 'num', def: 50 },
      { k: 'crown', label: 'Выпуклость h (0 = нет)', type: 'num', def: 0 },
      ...chamferFields, ...commonOuter],
  },
  coupling: {
    label: 'Втулка зубчатой соединительной муфты', icon: '⚙', gear: true, fields: [
      { k: 'm', label: 'Модуль m', type: 'num', def: 2.5 },
      { k: 'z', label: 'Число зубьев z', type: 'int', def: 38 },
      { k: 'L', label: 'Ширина венца b', type: 'num', def: 15 },
      { k: 'crowned', label: 'Бочкообразные зубья', type: 'bool', def: true },
      precision,
      ...chamferFields, ...commonOuter],
  },
  couplingBlind: {
    label: 'Втулка зубчатой глухой муфты', icon: '⚙', gear: true, fields: [
      { k: 'm', label: 'Модуль m', type: 'num', def: 2.5 },
      { k: 'z', label: 'Число зубьев z', type: 'int', def: 38 },
      { k: 'L', label: 'Ширина венца b', type: 'num', def: 15 },
      precision,
      ...chamferFields, ...commonOuter],
  },
};

export const OUTER_GROUPS = [
  { name: 'Ступени', items: ['cyl', 'cone', 'hex', 'square'] },
  { name: 'Резьба и шлицы', items: ['thread', 'spline'] },
  { name: 'Зубчатые передачи', items: ['spur', 'bevel', 'wormwheel', 'worm'] },
  { name: 'Цепные и ремённые', items: ['sprocket', 'vpulley', 'tpulley', 'fpulley'] },
  { name: 'Муфты', items: ['coupling', 'couplingBlind'] },
];

const innerCommon = [
  { k: 'ra', label: 'Шероховатость Ra', type: 'ra', def: '' },
  { k: 'noLen', label: 'Не ставить размер длины', type: 'bool', def: false },
];

export const INNER = {
  bore: {
    label: 'Отверстие цилиндрическое', icon: '○', fields: [
      { k: 'D', label: 'Диаметр d', type: 'num', def: 20 },
      { k: 'L', label: 'Глубина L', type: 'num', def: 30 },
      holeFitField,
      { k: 'ch', label: 'Фаска на входе, мм', type: 'num', def: 0 },
      ...innerCommon],
  },
  cone: {
    label: 'Отверстие коническое', icon: '⏢', fields: [
      { k: 'D', label: 'Диаметр у входа d1', type: 'num', def: 24 },
      { k: 'D2', label: 'Диаметр в глубине d2', type: 'num', def: 18 },
      { k: 'L', label: 'Глубина L', type: 'num', def: 30 },
      ...innerCommon],
  },
  hex: {
    label: 'Шестигранное отверстие', icon: '⬡', fields: [
      { k: 'S', label: 'Размер под ключ S', type: 'num', def: 10 },
      { k: 'L', label: 'Глубина L', type: 'num', def: 12 },
      ...innerCommon],
  },
  square: {
    label: 'Квадратное отверстие', icon: '◻', fields: [
      { k: 'S', label: 'Сторона S', type: 'num', def: 10 },
      { k: 'L', label: 'Глубина L', type: 'num', def: 12 },
      ...innerCommon],
  },
  ithread: {
    label: 'Резьба внутренняя', icon: '⫼', fields: [
      { k: 'D', label: 'Номинальный диаметр d', type: 'num', def: 12 },
      { k: 'P', label: 'Шаг P', type: 'num', def: 1.75 },
      { k: 'L', label: 'Длина резьбы L', type: 'num', def: 20 },
      { k: 'tol', label: 'Поле допуска', type: 'text', def: '7H' },
      { k: 'lh', label: 'Левая резьба', type: 'bool', def: false },
      { k: 'ch', label: 'Фаска на входе, мм', type: 'num', def: 1 },
      ...innerCommon],
  },
  blind: {
    label: 'Глухое отверстие (сверлёное)', icon: '▽', fields: [
      { k: 'D', label: 'Диаметр d', type: 'num', def: 10.2 },
      { k: 'L', label: 'Глубина до конуса L', type: 'num', def: 25 },
      { k: 'ang', label: 'Угол сверла, °', type: 'num', def: 118 },
      ...innerCommon],
  },
  center: {
    label: 'Центровое отверстие', icon: '⊙', fields: [
      { k: 'form', label: 'Форма (ГОСТ 14034)', type: 'sel', def: 'A', opts: ['A', 'B', 'R', 'F'] },
      { k: 'd', label: 'Диаметр d', type: 'sel', def: '3,15', opts: ['1', '1,6', '2', '2,5', '3,15', '4', '5', '6,3', '8', '10', '12'] },
      { k: 'show', label: 'Изображать условно (только обозначение)', type: 'bool', def: false },
    ],
  },
  igear: {
    label: 'Колесо с внутренним зацеплением', icon: '⚙', gear: true, fields: [
      { k: 'm', label: 'Модуль m', type: 'num', def: 2 },
      { k: 'z', label: 'Число зубьев z', type: 'int', def: 40 },
      { k: 'x', label: 'Коэф. смещения x', type: 'num', def: 0 },
      { k: 'L', label: 'Ширина венца b', type: 'num', def: 20 },
      precision,
      ...innerCommon],
  },
  ispline: {
    label: 'Шлицевое отверстие', icon: '✱', fields: [
      { k: 'kind', label: 'Вид', type: 'sel', def: 'прямобочные', opts: ['прямобочные', 'эвольвентные'] },
      { k: 'z', label: 'Число зубьев z', type: 'int', def: 6 },
      { k: 'd', label: 'Внутренний d', type: 'num', def: 23, show: p => p.kind === 'прямобочные' },
      { k: 'D', label: 'Наружный D', type: 'num', def: 26 },
      { k: 'b', label: 'Ширина паза b', type: 'num', def: 6, show: p => p.kind === 'прямобочные' },
      { k: 'm', label: 'Модуль m', type: 'num', def: 1.25, show: p => p.kind === 'эвольвентные' },
      { k: 'L', label: 'Длина L', type: 'num', def: 30 },
      { k: 'des', label: 'Обозначение (пусто = авто)', type: 'text', def: '' },
      ...innerCommon],
  },
};

export const INNER_GROUPS = [
  { name: 'Ступени отверстия', items: ['bore', 'cone', 'hex', 'square'] },
  { name: 'Отверстия', items: ['blind', 'center', 'ithread'] },
  { name: 'Зубчатые и шлицевые', items: ['igear', 'ispline'] },
];

// Элементы, привязанные к ступени (несколько на одной ступени)
export const FEATURES = {
  groove: {
    label: 'Канавка', icon: '⊔', fields: [
      { k: 'kind', label: 'Назначение', type: 'sel', def: 'выход резьбы', opts: ['выход резьбы', 'шлифовальная', 'стопорное кольцо', 'прямоугольная'] },
      { k: 'at', label: 'Положение', type: 'sel', def: 'справа', opts: ['слева', 'справа', 'по координате'] },
      { k: 'pos', label: 'Расстояние от левого края ступени', type: 'num', def: 10, show: p => p.at === 'по координате' },
      { k: 'b', label: 'Ширина b', type: 'num', def: 3 },
      { k: 'dg', label: 'Диаметр дна (0 = авто)', type: 'num', def: 0 },
      { k: 'r', label: 'Радиус R у дна', type: 'num', def: 0.5 },
    ],
  },
  keyway: {
    label: 'Шпоночный паз', icon: '▬', fields: [
      { k: 'kind', label: 'Шпонка', type: 'sel', def: 'призматическая', opts: ['призматическая', 'сегментная'] },
      { k: 'auto', label: 'Размеры по ГОСТ (авто)', type: 'bool', def: true },
      { k: 'b', label: 'Ширина паза b', type: 'num', def: 12, show: p => !p.auto },
      { k: 't', label: 'Глубина t1', type: 'num', def: 5, show: p => !p.auto },
      { k: 'len', label: 'Длина паза l', type: 'num', def: 32, show: p => p.kind === 'призматическая' },
      { k: 'dseg', label: 'Диаметр сегм. шпонки', type: 'num', def: 22, show: p => p.kind === 'сегментная' },
      { k: 'pos', label: 'От левого края ступени', type: 'num', def: 5 },
      { k: 'angle', label: 'Расположение', type: 'sel', def: 'к зрителю', opts: ['к зрителю', 'сверху', 'снизу', 'от зрителя'] },
      { k: 'fitb', label: 'Допуск ширины', type: 'sel', def: 'N9', opts: ['N9', 'P9', 'JS9', ''] },
    ],
  },
  crosshole: {
    label: 'Поперечное отверстие', icon: '⊕', fields: [
      { k: 'd', label: 'Диаметр d', type: 'num', def: 8 },
      { k: 'pos', label: 'Центр от левого края ступени', type: 'num', def: 10 },
      { k: 'through', label: 'Сквозное', type: 'bool', def: true },
      { k: 'depth', label: 'Глубина', type: 'num', def: 10, show: p => !p.through },
      { k: 'angle', label: 'Направление', type: 'sel', def: 'к зрителю', opts: ['к зрителю', 'вертикально'] },
      { k: 'thr', label: 'Резьба (напр. M8), пусто = нет', type: 'text', def: '' },
    ],
  },
  faceholes: {
    label: 'Отверстия на торце по окружности', icon: '⁘', fields: [
      { k: 'side', label: 'Торец ступени', type: 'sel', def: 'левый', opts: ['левый', 'правый'] },
      { k: 'n', label: 'Количество', type: 'int', def: 4 },
      { k: 'd', label: 'Диаметр отверстия', type: 'num', def: 6.8 },
      { k: 'pcd', label: 'Диаметр окружности центров', type: 'num', def: 30 },
      { k: 'depth', label: 'Глубина', type: 'num', def: 15 },
      { k: 'thr', label: 'Резьба (напр. M8), пусто = нет', type: 'text', def: '' },
      { k: 'a0', label: 'Угол первого отв., °', type: 'num', def: 45 },
    ],
  },
  facegroove: {
    label: 'Кольцевая канавка на торце', icon: '◎', fields: [
      { k: 'side', label: 'Торец ступени', type: 'sel', def: 'левый', opts: ['левый', 'правый'] },
      { k: 'dIn', label: 'Внутренний диаметр', type: 'num', def: 20 },
      { k: 'dOut', label: 'Наружный диаметр', type: 'num', def: 30 },
      { k: 'depth', label: 'Глубина', type: 'num', def: 5 },
    ],
  },
  ringhole: {
    label: 'Кольцевое отверстие (радиальные по окружности)', icon: '✣', fields: [
      { k: 'n', label: 'Количество отверстий', type: 'int', def: 4 },
      { k: 'd', label: 'Диаметр отверстия', type: 'num', def: 6 },
      { k: 'pos', label: 'От левого края ступени', type: 'num', def: 10 },
      { k: 'depth', label: 'Глубина (0 = до оси)', type: 'num', def: 0 },
      { k: 'a0', label: 'Угол первого отв., °', type: 'num', def: 90 },
    ],
  },
};
export const OUTER_FEATURES = ['groove', 'keyway', 'crosshole', 'ringhole', 'faceholes', 'facegroove'];
export const INNER_FEATURES = ['igroove', 'ikeyway'];

FEATURES.igroove = {
  label: 'Канавка в отверстии', icon: '⊔', fields: [
    { k: 'kind', label: 'Назначение', type: 'sel', def: 'стопорное кольцо', opts: ['стопорное кольцо', 'выход резьбы', 'прямоугольная'] },
    { k: 'pos', label: 'От начала ступени (от торца)', type: 'num', def: 5 },
    { k: 'b', label: 'Ширина b', type: 'num', def: 2 },
    { k: 'dg', label: 'Диаметр канавки (0 = авто)', type: 'num', def: 0 },
  ],
};
FEATURES.ikeyway = {
  label: 'Шпоночный паз в отверстии', icon: '▬', fields: [
    { k: 'auto', label: 'Размеры по ГОСТ (авто)', type: 'bool', def: true },
    { k: 'b', label: 'Ширина паза b', type: 'num', def: 6, show: p => !p.auto },
    { k: 't', label: 'Глубина t2', type: 'num', def: 2.8, show: p => !p.auto },
    { k: 'angle', label: 'Расположение', type: 'sel', def: 'сверху', opts: ['сверху', 'снизу'] },
    { k: 'fitb', label: 'Допуск ширины', type: 'sel', def: 'JS9', opts: ['JS9', 'P9', 'D10', ''] },
  ],
};

export const MATERIALS = [
  'Сталь 45 ГОСТ 1050-2013', 'Сталь 40Х ГОСТ 4543-2016', 'Сталь 40ХН ГОСТ 4543-2016', 'Сталь 20Х ГОСТ 4543-2016',
  'Сталь 18ХГТ ГОСТ 4543-2016', 'Сталь 12ХН3А ГОСТ 4543-2016', 'Сталь 35 ГОСТ 1050-2013', 'Сталь 20 ГОСТ 1050-2013',
  'Ст3 ГОСТ 380-2005', 'Сталь 65Г ГОСТ 14959-2016', 'Сталь 12Х18Н10Т ГОСТ 5632-2014', 'Сталь 38Х2МЮА ГОСТ 4543-2016',
  'БрА9Ж3Л ГОСТ 493-79', 'Д16Т ГОСТ 4784-2019', 'СЧ20 ГОСТ 1412-85',
];

export const TT_TEMPLATES = [
  '*Размеры для справок.',
  'Неуказанные предельные отклонения размеров: валов h14, отверстий H14, остальных ±IT14/2.',
  'Неуказанные радиусы скруглений 1 мм max.',
  'Неуказанные фаски 1×45°.',
  '240...280 HB.',
  'HRC 40...45.',
  'Цементировать h 0,8...1,2 мм, HRC 56...62.',
  'Закалить ТВЧ h 1,5...2 мм, HRC 48...52.',
  'Острые кромки притупить.',
  'Центровые отверстия B3,15 ГОСТ 14034-74.',
  'Покрытие: Хим.Окс.прм.',
];

function defaults(fields) {
  const o = {};
  for (const f of fields) o[f.k] = f.def;
  return o;
}

let _id = 1;
export function uid() { return 'e' + Date.now().toString(36) + (_id++).toString(36); }

export function newSegment(kind, type) {
  const cat = kind === 'outer' ? OUTER : INNER;
  return { id: uid(), type, ...defaults(cat[type].fields), features: [] };
}
export function newFeature(type) {
  return { id: uid(), type, ...defaults(FEATURES[type].fields) };
}

export function newProject() {
  const p = {
    version: 1,
    meta: {
      designation: 'АБВГ.715411.001', name: 'Вал', material: MATERIALS[0], org: '', developer: '', checker: '',
      tcontrol: '', ncontrol: '', approved: '', raGeneral: '6,3', mass: '', litera: '',
      format: 'авто', scale: 'авто', dims: 'цепь', closing: 'последняя', view: 'вид', sheetMode: 'лист',
      tt: [TT_TEMPLATES[1], TT_TEMPLATES[2]],
    },
    outer: [],
    innerL: [],
    innerR: [],
    sections: [],
  };
  const a = newSegment('outer', 'cyl'); Object.assign(a, { D: 30, L: 40, chL: 1, fit: 'k6', ra: '1,6' });
  const b = newSegment('outer', 'cyl'); Object.assign(b, { D: 40, L: 60, fit: '' });
  const c = newSegment('outer', 'cyl'); Object.assign(c, { D: 35, L: 50, chR: 1, fit: 'k6', ra: '1,6' });
  p.outer.push(a, b, c);
  return p;
}

export const FIELD_OF = (cat, type) => (cat === 'outer' ? OUTER : cat === 'inner' ? INNER : FEATURES)[type];
