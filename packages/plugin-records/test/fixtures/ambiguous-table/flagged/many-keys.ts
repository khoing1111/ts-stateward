const weekdays: { [day: string]: number } = {
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
  sun: 7,
};

const oddKeys: { [key: string]: number } = { "extra-large": 3, 2: 1, plain: 0 };

export const monday = weekdays.mon;
export const extraLarge = oddKeys["extra-large"];
