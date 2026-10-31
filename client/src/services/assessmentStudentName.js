export function assessmentStudentName(student) {
  const name = String(student?.name || "").trim();
  const comma = name.indexOf(",");
  const words = name.split(/\s+/);
  const lastName = student?.lastName?.trim() || (comma >= 0 ? name.slice(0, comma).trim() : words.at(-1));
  let givenNames = student?.firstName?.trim() || (comma >= 0 ? name.slice(comma + 1).trim() : words.slice(0, -1).join(" "));

  // Keep middle names/initials present in the full name but absent from firstName.
  const surnameSuffix = ` ${lastName}`;
  const fullGivenNames = comma >= 0
    ? name.slice(comma + 1).trim()
    : lastName && name.toLocaleLowerCase().endsWith(surnameSuffix.toLocaleLowerCase())
      ? name.slice(0, -surnameSuffix.length).trim()
      : "";
  if (fullGivenNames) {
    if (!givenNames || fullGivenNames === givenNames || fullGivenNames.startsWith(`${givenNames} `)) {
      givenNames = fullGivenNames;
    }
  }

  return [lastName, givenNames].filter(Boolean).join(", ") || "Unknown";
}
