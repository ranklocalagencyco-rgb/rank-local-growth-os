import Link from "next/link";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/prospects", label: "Prospects" },
];

export function Navigation() {
  return (
    <header className="site-header">
      <Link className="brand" href="/">Rank Local <span>Growth OS</span></Link>
      <nav aria-label="Primary navigation">
        {links.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
      </nav>
      <span className="environment-pill">Local</span>
    </header>
  );
}
