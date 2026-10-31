const assets = {
  full: "/gradesense-ai-logo.png",
  compact: "/gradesense-ai-logo-compact.png",
  icon: "/gradesense-ai-icon.png"
};

export default function BrandLogo({ variant = "full", className = "", alt = "GradeSense AI" }) {
  return <img className={`brand-logo brand-logo--${variant} ${className}`.trim()} src={assets[variant] || assets.full} alt={alt} />;
}
