import { useEffect, useRef } from 'react'
import * as THREE from 'three'

/**
 * ThreeCanvas
 * -----------------------------------------------------------------------------
 * 一个使用「纯原生 Three.js API」搭建的全屏 WebGL 底层画布组件。
 *
 * 设计要点：
 *  1. <canvas> 采用 fixed 定位铺满视口，并设置 pointer-events: none，
 *     让用户的鼠标 / 触摸事件穿透到下层的 HTML 内容，从而正常滚动页面。
 *  2. 所有 Three.js 资源（Scene / Camera / Renderer / Geometry / Material）
 *     都在 useEffect 内部创建，并在 cleanup 阶段严格释放，避免 WebGL 内存泄漏。
 *  3. 严禁使用 react-three-fiber / drei，完全手写渲染循环生命周期。
 * -----------------------------------------------------------------------------
 */
export default function ThreeCanvas() {
  // canvas DOM 引用：直接把 WebGLRenderer 绑定到这个真实 canvas 上，
  // 避免让 Three.js 自己再生成一个 canvas（更利于用 CSS 精确控制）。
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // ---------------------------------------------------------------------
    // 1. 视口尺寸对象（后续 resize 时统一更新，避免散落的 window 读取）
    // ---------------------------------------------------------------------
    const sizes = {
      width: window.innerWidth,
      height: window.innerHeight,
    }

    // ---------------------------------------------------------------------
    // 2. Scene（场景根节点）
    // ---------------------------------------------------------------------
    const scene = new THREE.Scene()

    // ---------------------------------------------------------------------
    // 3. PerspectiveCamera（透视相机）
    //    fov=45 更接近电影镜头的自然透视；near/far 控制裁剪范围。
    // ---------------------------------------------------------------------
    const camera = new THREE.PerspectiveCamera(
      45, // 视场角 (Field of View)
      sizes.width / sizes.height, // 宽高比 (Aspect Ratio)
      0.1, // 近裁剪面 (Near)
      100, // 远裁剪面 (Far)
    )
    camera.position.set(0, 0, 6)
    scene.add(camera)

    // ---------------------------------------------------------------------
    // 4. 灯光：环境光提供整体基础亮度，方向光模拟主光源产生立体明暗
    // ---------------------------------------------------------------------
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
    scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 2.4)
    directionalLight.position.set(3, 4, 5)
    scene.add(directionalLight)

    // ---------------------------------------------------------------------
    // 5. 临时占位 Mesh：一个带轻微金属质感的圆角效果球体，
    //    用于第一时间验证渲染管线是否正常工作。后续阶段会替换为耳机模型。
    // ---------------------------------------------------------------------
    const geometry = new THREE.IcosahedronGeometry(1.4, 1) // 低多边形二十面体，科技感更强
    const material = new THREE.MeshStandardMaterial({
      color: 0x4f8cff,
      metalness: 0.6,
      roughness: 0.25,
      flatShading: true, // 保留低多边形硬边面，呈现「切面」质感
    })
    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)

    // ---------------------------------------------------------------------
    // 6. WebGLRenderer（渲染器）
    //    - antialias: true 开启硬件抗锯齿，边缘更平滑
    //    - alpha: true 让画布背景透明，可透出底层 HTML 深色背景
    // ---------------------------------------------------------------------
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })
    renderer.setSize(sizes.width, sizes.height)

    // 性能优化：像素比最高只取 2。
    // 高分屏（如某些手机 DPR=3/4）若全量渲染会造成巨大的 GPU 负担，
    // 限制在 2 以内是性能与清晰度的最佳平衡点。
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    // 使用现代色彩空间，让颜色输出更接近真实（sRGB）。
    renderer.outputColorSpace = THREE.SRGBColorSpace

    // ---------------------------------------------------------------------
    // 7. resize 处理：窗口尺寸变化时，同步更新相机宽高比与渲染器尺寸
    // ---------------------------------------------------------------------
    const handleResize = () => {
      sizes.width = window.innerWidth
      sizes.height = window.innerHeight

      // 更新相机宽高比并「重算投影矩阵」，否则画面会被拉伸变形。
      camera.aspect = sizes.width / sizes.height
      camera.updateProjectionMatrix()

      // 更新渲染器画布尺寸，并再次夹紧像素比（用户可能把窗口拖到别的屏幕）。
      renderer.setSize(sizes.width, sizes.height)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    }
    window.addEventListener('resize', handleResize)

    // ---------------------------------------------------------------------
    // 8. 渲染循环 tick：基于 requestAnimationFrame 的标准帧驱动。
    //    使用 THREE.Clock 获取与帧率无关的时间增量，保证动画速度一致。
    // ---------------------------------------------------------------------
    const clock = new THREE.Clock()
    let animationFrameId = 0

    const tick = () => {
      const elapsedTime = clock.getElapsedTime()

      // 简单的自转，证明渲染循环正在持续工作
      mesh.rotation.y = elapsedTime * 0.4
      mesh.rotation.x = elapsedTime * 0.15

      renderer.render(scene, camera)

      // 保存句柄，便于卸载时取消，防止组件销毁后循环仍在跑
      animationFrameId = window.requestAnimationFrame(tick)
    }
    tick()

    // ---------------------------------------------------------------------
    // 9. 清理函数：组件卸载时彻底释放所有 GPU / 事件资源，杜绝内存泄漏
    // ---------------------------------------------------------------------
    return () => {
      // 停止渲染循环
      window.cancelAnimationFrame(animationFrameId)

      // 移除事件监听
      window.removeEventListener('resize', handleResize)

      // 释放几何体与材质占用的显存
      geometry.dispose()
      material.dispose()

      // 释放渲染器持有的 WebGL 上下文与内部缓冲
      renderer.dispose()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      // fixed + inset-0 铺满视口；-z-10 置于 HTML 内容之下；
      // pointer-events-none 让滚动 / 点击事件穿透到下层 HTML。
      className="fixed inset-0 -z-10 h-full w-full pointer-events-none"
    />
  )
}