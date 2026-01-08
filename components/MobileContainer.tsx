import type { ReactNode } from "react";

export default function MobileContainer({ children }: { children: ReactNode }) {
    return <div className="mx-auto max-w-md p-4">{children}</div>;
}
