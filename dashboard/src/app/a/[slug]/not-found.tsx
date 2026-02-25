import { ConvosLogo } from "@/components/convos-logo";

export default function TemplateNotFound() {
  return (
    <div className="min-h-screen bg-[#f5f5f5] flex flex-col items-center font-[Inter,sans-serif]">
      {/* Header */}
      <header className="w-full max-w-2xl px-6 pt-8 pb-4">
        <a href="/" className="inline-flex items-center gap-2 no-underline">
          <ConvosLogo width={18} height={23} />
          <span className="text-sm font-semibold text-[#333] tracking-[-0.3px]">
            Convos
          </span>
        </a>
      </header>

      {/* Content */}
      <main className="w-full max-w-2xl px-6 pb-12">
        <div className="bg-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-8 sm:p-10 text-center">
          <span className="text-5xl mb-4 block">🔍</span>
          <h1 className="text-2xl font-bold text-[#111] tracking-[-0.5px] mb-2">
            Assistant not found
          </h1>
          <p className="text-base text-[#666] mb-6">
            The assistant you are looking for does not exist or has been removed.
          </p>
          <a
            href="/"
            className="inline-flex items-center justify-center px-6 py-3 text-base font-semibold text-white bg-[#E54D00] rounded-xl no-underline hover:bg-[#cc4400] transition-colors"
          >
            Browse all assistants
          </a>
        </div>
      </main>
    </div>
  );
}
