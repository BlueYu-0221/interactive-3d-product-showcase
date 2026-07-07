import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

// 注册 GSAP 插件（模块级注册一次即可，重复注册无副作用）。
gsap.registerPlugin(ScrollTrigger)

/**
 * ThreeCanvas（阶段二）
 * -----------------------------------------------------------------------------
 * 在阶段一的 WebGL 地基（Scene / Camera / Renderer / Resize / Cleanup）之上，
 * 使用「纯原生 Three.js」完成：
 *   1. GLTFLoader 加载真实耳机模型 headphone.glb，并自动居中 + 缩放。
 *   2. 从模型中抓取左右耳罩子物体，供 GSAP 拆解动画使用。
 *   3. 绑定基于窗口滚动的 GSAP ScrollTrigger timeline：
 *        - 前 50%：整机顺时针自转 180° 并沿 Z 轴靠近相机。
 *        - 后 50%：Apple 风格拆解，左右耳罩沿 X 轴向两侧推开。
 *   4. 组件卸载时销毁所有 ScrollTrigger 实例，防止多页面切换动画错乱。
 *
 * 严禁使用 react-three-fiber / drei，全部手写生命周期。
 * -----------------------------------------------------------------------------
 */

// 左右耳罩子物体名称：请用 3D 软件 / 控制台打印 model 结构后，替换成真实名字。
// 提示：加载完成后代码会 console.log 出模型层级树，方便你直接复制名字填入。
const LEFT_NAME = '请替换为左耳罩名字'
const RIGHT_NAME = '请替换为右耳罩名字'

export default function ThreeCanvas() {
  // canvas DOM 引用：把 WebGLRenderer 直接绑定到真实 canvas，便于 CSS 精确控制。
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // ---------------------------------------------------------------------
    // 1. 视口尺寸对象（resize 时统一更新）
    // ---------------------------------------------------------------------
    const sizes = {
      width: window.innerWidth,
      height: window.innerHeight,
    }

    // ---------------------------------------------------------------------
    // 2. Scene / Camera / Lights（地基部分，与阶段一一致）
    // ---------------------------------------------------------------------
    const scene = new THREE.Scene()

    const camera = new THREE.PerspectiveCamera(
      45, // 视场角 (Field of View)
      sizes.width / sizes.height, // 宽高比 (Aspect Ratio)
      0.1, // 近裁剪面 (Near)
      100, // 远裁剪面 (Far)
    )
    camera.position.set(0, 0, 6)
    scene.add(camera)

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8)
    scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 2.4)
    directionalLight.position.set(3, 4, 5)
    scene.add(directionalLight)

    // 补一盏侧后方光，让金属 / 塑料材质的高光更立体（可选）。
    const rimLight = new THREE.DirectionalLight(0xffffff, 1.2)
    rimLight.position.set(-4, 2, -5)
    scene.add(rimLight)

    // ---------------------------------------------------------------------
    // 3. WebGLRenderer（渲染器，含性能优化）
    // ---------------------------------------------------------------------
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true, // 硬件抗锯齿，边缘更平滑
      alpha: true, // 背景透明，透出底层 HTML 深色背景
      powerPreference: 'high-performance',
    })
    renderer.setSize(sizes.width, sizes.height)
    // 像素比最高夹紧到 2，避免高 DPR 屏幕（DPR=3/4）过度渲染拖垮 GPU。
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace

    // ---------------------------------------------------------------------
    // 4. 加载 GLTF 模型 + 抓取左右耳罩子物体
    //    这些引用需在 useEffect 作用域内声明，供 tick / ScrollTrigger 共享。
    // ---------------------------------------------------------------------
    let model: THREE.Object3D | null = null
    let leftComponent: THREE.Object3D | null = null
    let rightComponent: THREE.Object3D | null = null

    // 保存记录左右耳罩「初始 X 坐标」，动画基于初始位置做相对偏移，避免多次触发累加。
    let leftInitialX = 0
    let rightInitialX = 0

    const loader = new GLTFLoader()
    // 用 Vite 的 BASE_URL 拼接资源路径，兼容配置了 base（如 /interactive-3d-product-showcase/）的场景。
    // 直接写死 '/headphone.glb' 会忽略 base 前缀，导致部署 / 预览时 404。
    const modelUrl = `${import.meta.env.BASE_URL}headphone.glb`.replace(/\/{2,}/g, '/')
    loader.load(
      modelUrl,
      (gltf: GLTF) => {
        model = gltf.scene

        // --- 4.1 自动居中：把模型几何中心平移回原点 ---
        const box = new THREE.Box3().setFromObject(model)
        const center = box.getCenter(new THREE.Vector3())
        model.position.sub(center) // 让模型中心对齐世界原点

        // --- 4.2 自动缩放：按包围盒最大边把模型归一化到合适尺寸 ---
        const size = box.getSize(new THREE.Vector3())
        const maxAxis = Math.max(size.x, size.y, size.z)
        const targetSize = 3.2 // 目标显示尺寸（世界单位），可按需微调
        const scale = maxAxis > 0 ? targetSize / maxAxis : 1
        model.scale.setScalar(scale)

        // --- 4.3 打印模型层级树，帮助你查到左右耳罩的真实名字 ---
        // 拿到名字后，把上方 LEFT_NAME / RIGHT_NAME 替换即可。
        console.group('[headphone.glb] 模型层级结构（用于定位左右耳罩名字）')
        model.traverse((child: THREE.Object3D) => {
          if (child.name) {
            console.log(`name: "${child.name}"  type: ${child.type}`)
          }
        })
        console.groupEnd()

        // --- 4.4 抓取左右耳罩子物体 ---
        leftComponent = model.getObjectByName(LEFT_NAME) ?? null
        rightComponent = model.getObjectByName(RIGHT_NAME) ?? null

        if (leftComponent) leftInitialX = leftComponent.position.x
        if (rightComponent) rightInitialX = rightComponent.position.x

        if (!leftComponent || !rightComponent) {
          console.warn(
            '[ThreeCanvas] 未能通过名字找到左右耳罩，请根据上方打印的层级树，' +
              '替换 LEFT_NAME / RIGHT_NAME 常量。当前拆解动画将被跳过。',
          )
        }

        scene.add(model)

        // 模型就绪后再构建滚动动画，确保 timeline 能拿到真实引用。
        buildScrollAnimation()
      },
      undefined,
      (error: unknown) => {
        console.error('[ThreeCanvas] 加载 headphone.glb 失败：', error)
      },
    )

    // ---------------------------------------------------------------------
    // 5. 构建 GSAP ScrollTrigger 动画（关联窗口整体滚动）
    // ---------------------------------------------------------------------
    const buildScrollAnimation = (): void => {
      // timeline 以窗口滚动为触发源：起点=页面顶部，终点=页面底部。
      // scrub: 1 让动画平滑地紧跟滚轮刻度（数值为追赶的秒数，越大越顺滑）。
      const timeline = gsap.timeline({
        scrollTrigger: {
          trigger: document.documentElement,
          start: 'top top', // 页面顶部对齐视口顶部
          end: 'bottom bottom', // 页面底部对齐视口底部
          scrub: 1,
        },
      })

      // --- 剧情 A（前 50% 滚动区间）：整机自转 180° + 向相机靠近 ---
      if (model) {
        timeline.to(
          model.rotation,
          {
            y: Math.PI, // 顺时针自转 180 度
            ease: 'none',
            duration: 0.5, // 占 timeline 前半段
          },
          0, // 从 timeline 0 时刻开始
        )
        timeline.to(
          model.position,
          {
            z: 1.2, // 沿 Z 轴向相机方向靠近一些
            ease: 'none',
            duration: 0.5,
          },
          0,
        )
      }

      // --- 剧情 B（后 50% 滚动区间）：Apple 风格左右耳罩拆解 ---
      if (leftComponent) {
        timeline.to(
          leftComponent.position,
          {
            x: leftInitialX - 1.5, // 基于初始位置向左推开
            ease: 'power1.inOut',
            duration: 0.5, // 占 timeline 后半段
          },
          0.5, // 从 timeline 中点开始
        )
      }
      if (rightComponent) {
        timeline.to(
          rightComponent.position,
          {
            x: rightInitialX + 1.5, // 基于初始位置向右推开
            ease: 'power1.inOut',
            duration: 0.5,
          },
          0.5,
        )
      }
    }

    // ---------------------------------------------------------------------
    // 6. resize 处理：同步相机宽高比与渲染器尺寸
    // ---------------------------------------------------------------------
    const handleResize = () => {
      sizes.width = window.innerWidth
      sizes.height = window.innerHeight

      camera.aspect = sizes.width / sizes.height
      camera.updateProjectionMatrix() // 重算投影矩阵，避免画面拉伸变形

      renderer.setSize(sizes.width, sizes.height)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    }
    window.addEventListener('resize', handleResize)

    // ---------------------------------------------------------------------
    // 7. 渲染循环 tick：基于 requestAnimationFrame 的标准帧驱动
    //    模型的姿态由 GSAP 直接写入 rotation/position，这里只负责持续渲染。
    // ---------------------------------------------------------------------
    let animationFrameId = 0
    const tick = () => {
      renderer.render(scene, camera)
      animationFrameId = window.requestAnimationFrame(tick)
    }
    tick()

    // ---------------------------------------------------------------------
    // 8. 清理函数：彻底释放事件 / GPU / 动画资源，杜绝内存泄漏与动画错乱
    // ---------------------------------------------------------------------
    return () => {
      // 停止渲染循环
      window.cancelAnimationFrame(animationFrameId)

      // 移除事件监听
      window.removeEventListener('resize', handleResize)

      // 销毁全部 ScrollTrigger 实例，防止多页面切换时动画错乱 / 内存泄漏
      ScrollTrigger.getAll().forEach((t) => t.kill())

      // 释放模型内部所有几何体与材质占用的显存
      if (model) {
        model.traverse((child: THREE.Object3D) => {
          const mesh = child as THREE.Mesh
          if (mesh.isMesh) {
            mesh.geometry?.dispose()
            const mat = mesh.material
            if (Array.isArray(mat)) {
           mat.forEach((m) => m.dispose())
            } else {
              mat?.dispose()
            }
          }
        })
        scene.remove(model)
      }

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