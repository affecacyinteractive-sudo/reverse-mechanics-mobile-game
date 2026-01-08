
import HandTray from "@/components/HandTray";
import HandSheet from "@/components/HandSheet";
import TabBar from "@/components/TabBar";


export default function ShellLayout({
                                        children,
                                    }: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <div className="min-h-dvh flex flex-col">
            {/* pb-24 prevents content from being hidden behind Hand+TabBar */}
            <main className="flex-1 overflow-y-auto pb-24">{children}</main>
            <HandTray />
            <HandSheet />
            <TabBar />
        </div>

    );
}
