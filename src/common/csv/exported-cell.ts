/** Undo only the initial apostrophe protection emitted by version 1 exports. */
export function decodeExportedCsvCell(value: string): string {
  if (value.startsWith("'") && (value[1] === "'" || /^[\s\uFEFF]*[=+\-@]/u.test(value.slice(1))))
    return value.slice(1);
  return value;
}

/** Split version 1 choices, preserving backslashes outside the two known escapes. */
export function splitExportedCsvChoices(value: string): string[] {
  const choices: string[] = [];
  let choice = '';
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '\\' && (value[index + 1] === '\\' || value[index + 1] === '|')) {
      choice += value[++index];
    } else if (char === '|') {
      choices.push(choice);
      choice = '';
    } else choice += char;
  }
  choices.push(choice);
  return choices;
}
