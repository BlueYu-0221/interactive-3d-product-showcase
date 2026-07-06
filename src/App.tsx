import ThreeCanvas from './components/ThreeCanvas'

/**
 * App
 * -----------------------------------------------------------------------------
 * 页面骨架（阶段一）：
 *  - 底层：固定定位的 <ThreeCanvas />（WebGL 3D 画布，pointer-events: none）。
 *  - 上层：多个 min-h-screen 的全屏 section 构成的长滚动 HTML 内容，
 *    用于营造真实的营销页滚动体感。后续阶段将由 GSAP ScrollTrigger 把
 *    滚动进度映射到 3D 场景动画上。
 * -----------------------------------------------------------------------------
 */
export default function App() {
  return (
    <div className="relative font-sans">
      {/* 底层固定 WebGL 画布 */}
      <ThreeCanvas />

      {/* 上层可滚动的 HTML 营销内容（z 层级高于画布） */}
      <main className="relative z-10">
        {/* ---------------- Section 1 · Hero ---------------- */}
        <section className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
          <p className="mb-4 text-sm font-medium uppercase tracking-[0.4em] text-blue-400">
            Introducing
          </p>
          <h1 className="bg-gradient-to-b from-white to-white/50 bg-clip-text text-7xl font-bold tracking-tight text-transparent sm:text-8xl md:text-9xl">
            CyberAudio
          </h1>
          <p className="mt-6 max-w-md text-lg text-white/60">
            重新定义沉浸式聆听。极简设计，极致音质。
          </p>
          <div className="absolute bottom-10 flex flex-col items-center text-white/40">
            <span className="text-xs uppercase tracking-widest">Scroll</span>
            <span className="mt-2 h-8 w-px animate-pulse bg-white/40" />
          </div>
        </section>

        {/* ---------------- Section 2 · Sound Architecture ---------------- */}
        <section className="flex min-h-screen flex-col justify-center px-8 md:px-24">
          <div className="max-w-xl">
            <p className="mb-4 text-sm font-medium uppercase tracking-[0.4em] text-blue-400">
              Engineering
            </p>
            <h2 className="text-5xl font-bold leading-tight tracking-tight sm:text-6xl md:text-7xl">
              Sound
              <br />
              Architecture
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-white/60">
              40mm 定制动圈单元航级铝合金腔体，
              每一层结构都为纯净声场而生。让声音拥有可被感知的形状。
            </p>
          </div>
        </section>

        {/* ---------------- Section 3 · Immersive ANC ---------------- */}
        <section className="flex min-h-screen flex-col items-end justify-center px-8 text-right md:px-24">
          <div className="max-w-xl">
            <p className="mb-4 text-sm font-medium uppercase tracking-[0.4em] text-blue-400">
              Silence
            </p>
            <h2 className="text-5xl font-bold leading-tight tracking-tight sm:text-6xl md:text-7xl">
              Immersive
              <br />
              ANC
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-white/60">
              自适应主动降噪，实时消解高达 98% 的环境噪声。
              于喧嚣之中，为你辟出一方绝对宁静。
            </p>
          </div>
        </section>

        {/* ---------------- Section 4 · Call To Action ---------------- */}
        <section className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
          <h2 className="text-6xl font-bold tracking-tight sm:text-7xl md:text-8xl">
            听见未来。
          </h2>
          <p className="mt-6 max-w-md text-lg text-white/60">
            CyberAudio — 为热爱声音的你而造。
          </p>
          <button
            type="button"
            className="mt-10 rounded-full bg-white px-8 py-4 text-base font-semibold text-black transition-transform duration-300 hover:scale-105"
          >
            立即购买
          </button>
        </section>
      </main>
    </div>
  )
}