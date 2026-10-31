export const AGREEMENT_REQUIRED_MESSAGE = "Please agree to the Terms and Conditions and Privacy Policy to continue.";

export function signupValidationError(form) {
  if (!form.firstName.trim()) return "First name is required.";
  if (!form.lastName.trim()) return "Last name is required.";
  if (!form.email.trim()) return "Email address is required.";
  if (!form.password.trim()) return "Password is required.";
  if (typeof form.confirmPassword !== "string" || !form.confirmPassword.trim()) return "Confirm Password is required.";
  if (!form.role) return "Role is required.";
  if (form.role === "student" && !form.studentNumber.trim()) return "Student Number is required for student accounts.";
  if (form.password.length < 8) return "Password must be at least 8 characters.";
  if (form.password !== form.confirmPassword) return "Passwords do not match.";
  if (form.agreementAccepted !== true) return AGREEMENT_REQUIRED_MESSAGE;
  return "";
}
