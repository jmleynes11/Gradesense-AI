import { mediaUrl } from "../services/api";

export default function UserAvatar({ user, className = "h-10 w-10", textClassName = "text-sm", alt = "Profile photo" }) {
  const initials = (user?.name || user?.email || "GS")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  if (user?.profileImage) {
    return <img className={`${className} rounded-full object-cover`} src={mediaUrl(user.profileImage)} alt={alt} />;
  }

  return <div className={`grid ${className} place-items-center rounded-full bg-[#FFF3E8] font-black text-[#D94F00] ${textClassName}`}>{initials}</div>;
}
