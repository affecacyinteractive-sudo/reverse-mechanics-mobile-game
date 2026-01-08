"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
    { href: "/library", label: "Library" },
    { href: "/board", label: "Board" },
    { href: "/generated", label: "Generated" },
    { href: "/workshop", label: "Workshop" },
];

export default function TabBar() {
    const pathname = usePathname();

    return (
        <nav className="border-t bg-background">
            <div className="mx-auto max-w-md grid grid-cols-4">
                {tabs.map((t) => {
                    const active = pathname === t.href;
                    return (
                        <Link
                            key={t.href}
                            href={t.href}
                            className={[
                                "py-3 text-center text-sm",
                                active ? "font-semibold" : "opacity-70",
                            ].join(" ")}
                        >
                            {t.label}
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}
