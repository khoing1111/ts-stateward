type TheValueOfEveryEntryInTheTable = { text: string };

const aVeryLongVariableNameThatGoesOnAndOn: Record<string, TheValueOfEveryEntryInTheTable> = {
  first: { text: "1" },
};

const shortName: Record<string, TheValueOfEveryEntryInTheTable> = { first: { text: "1" } };

const aVeryLongMapNameThatKeepsGoingOnAndOn = new Map([["x", 1]]);

export const longRead = aVeryLongVariableNameThatGoesOnAndOn.first;
export const shortRead = shortName.first;
export const mapRead = aVeryLongMapNameThatKeepsGoingOnAndOn.get("x");
