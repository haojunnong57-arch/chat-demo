import { create } from 'zustand'

interface MobileSiderState {
  /** 抽屉是否展开 */
  open: boolean
  /** 手势跟手进度：0 = 完全关闭，1 = 完全展开；null 表示未在拖拽，开合动画走 CSS 类 */
  dragProgress: number | null
}

/** 移动端侧边栏抽屉：顶栏菜单按钮打开，点遮罩、切换会话或开启新对话后关闭；左缘右滑打开、抽屉内左滑关闭 */
export const useMobileSider = create<MobileSiderState>(() => ({ open: false, dragProgress: null }))

export const openMobileSider = () => useMobileSider.setState({ open: true })

export const closeMobileSider = () => useMobileSider.setState({ open: false })

/** 拖拽过程中写入 0..1 的跟手进度；手势结束置回 null，交回 CSS 吸附动画 */
export const setMobileSiderDrag = (progress: number | null) =>
  useMobileSider.setState({ dragProgress: progress })
