import { useRef, useState, useCallback, type ReactNode } from "react"
import { ScrollView, StyleSheet, PanResponder, type LayoutChangeEvent, type ViewStyle, type StyleProp } from "react-native"
import { isHorizontalIntent, clampOffset } from "../lib/horizontal-intent"

interface Props {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  contentContainerStyle?: StyleProp<ViewStyle>
  nestedScrollEnabled?: boolean
  testID?: string
}

export function WideScroll({ children, style, contentContainerStyle, nestedScrollEnabled, testID }: Props) {
  const ref = useRef<ScrollView>(null)
  const [contentWidth, setContentWidth] = useState(0)
  const [layoutWidth, setLayoutWidth] = useState(0)
  const maxOffset = Math.max(0, contentWidth - layoutWidth)

  const onContentLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width
    setContentWidth((prev) => (prev !== w ? w : prev))
  }, [])

  const onOuterLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width
    setLayoutWidth((prev) => (prev !== w ? w : prev))
  }, [])

  // PanResponder: only claim the gesture when the drag is clearly
  // horizontal. Vertical drags pass through to the parent transcript
  // FlatList so reading history isn't interrupted.
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gestureState) => {
        return isHorizontalIntent({ dx: gestureState.dx, dy: gestureState.dy })
      },
      onPanResponderGrant: () => {
        // Cancel any in-flight fling animation so the gesture and
        // Animated.scrollAnimation don't compete.
      },
      onPanResponderMove: (_evt, gestureState) => {
        const current = -gestureState.dx
        const clamped = clampOffset(current, maxOffset)
        ref.current?.scrollTo({ x: clamped, animated: false })
      },
      onPanResponderRelease: (_evt, gestureState) => {
        const projected = -gestureState.dx + gestureState.vx * 0.3
        const target = clampOffset(projected, maxOffset)
        ref.current?.scrollTo({ x: target, animated: true })
      },
    }),
  ).current

  return (
    <ScrollView
      ref={ref}
      horizontal
      showsHorizontalScrollIndicator={true}
      style={[s.default, style]}
      contentContainerStyle={contentContainerStyle}
      nestedScrollEnabled={nestedScrollEnabled}
      testID={testID}
      onLayout={onOuterLayout}
      onContentSizeChange={(w) => setContentWidth((prev) => (prev !== w ? w : prev))}
      scrollEventThrottle={32}
      {...panResponder.panHandlers}
    >
      {children}
    </ScrollView>
  )
}

const s = StyleSheet.create({
  default: {},
})
