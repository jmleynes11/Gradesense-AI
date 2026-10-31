export function nameFields(user) {
  if (user?.firstName || user?.lastName) {
    return { firstName: user.firstName || "", lastName: user.lastName || "" };
  }
  const [firstName = "", ...lastName] = (user?.name || "").trim().split(/\s+/);
  return { firstName, lastName: lastName.join(" ") };
}
