import * as React from 'react'
import {
  LayoutChangeEvent,
  NativeScrollEvent,
  StyleSheet,
  View,
} from 'react-native'
import Animated, {
  Easing,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  runOnJS,
} from 'react-native-reanimated'
import {Pager, PagerRef, RenderTabBarFnProps} from 'view/com/pager/Pager'
import {TabBar} from './TabBar'
import {useWebMediaQueries} from 'lib/hooks/useWebMediaQueries'

const SCROLLED_DOWN_LIMIT = 200

interface PagerWithHeaderChildParams {
  headerHeight: number
  onScroll: (e: NativeScrollEvent) => void
  isScrolledDown: boolean
}

export interface PagerWithHeaderProps {
  testID?: string
  children:
    | (((props: PagerWithHeaderChildParams) => JSX.Element) | null)[]
    | ((props: PagerWithHeaderChildParams) => JSX.Element)
  items: string[]
  isHeaderReady: boolean
  renderHeader?: () => JSX.Element
  initialPage?: number
  onPageSelected?: (index: number) => void
  onCurrentPageSelected?: (index: number) => void
}
export const PagerWithHeader = React.forwardRef<PagerRef, PagerWithHeaderProps>(
  function PageWithHeaderImpl(
    {
      children,
      testID,
      items,
      isHeaderReady,
      renderHeader,
      initialPage,
      onPageSelected,
      onCurrentPageSelected,
    }: PagerWithHeaderProps,
    ref,
  ) {
    const {isMobile} = useWebMediaQueries()
    const [currentPage, setCurrentPage] = React.useState(0)
    const scrollYs = React.useRef<Record<number, number>>({})
    const scrollY = useSharedValue(scrollYs.current[currentPage] || 0)
    const [tabBarHeight, setTabBarHeight] = React.useState(0)
    const [headerOnlyHeight, setHeaderOnlyHeight] = React.useState(0)
    const [isScrolledDown, setIsScrolledDown] = React.useState(
      scrollYs.current[currentPage] > SCROLLED_DOWN_LIMIT,
    )

    const headerHeight = headerOnlyHeight + tabBarHeight

    // react to scroll updates
    function onScrollUpdate(v: number) {
      // track each page's current scroll position
      scrollYs.current[currentPage] = Math.min(v, headerOnlyHeight)
      // update the 'is scrolled down' value
      setIsScrolledDown(v > SCROLLED_DOWN_LIMIT)
    }
    useAnimatedReaction(
      () => scrollY.value,
      v => runOnJS(onScrollUpdate)(v),
    )

    // capture the header bar sizing
    const onTabBarLayout = React.useCallback(
      (evt: LayoutChangeEvent) => {
        setTabBarHeight(evt.nativeEvent.layout.height)
      },
      [setTabBarHeight],
    )
    const onHeaderOnlyLayout = React.useCallback(
      (evt: LayoutChangeEvent) => {
        setHeaderOnlyHeight(evt.nativeEvent.layout.height)
      },
      [setHeaderOnlyHeight],
    )

    // render the the header and tab bar
    const headerTransform = useAnimatedStyle(
      () => ({
        transform: [
          {
            translateY: Math.min(
              Math.min(scrollY.value, headerOnlyHeight) * -1,
              0,
            ),
          },
        ],
      }),
      [scrollY, headerHeight, tabBarHeight],
    )
    const renderTabBar = React.useCallback(
      (props: RenderTabBarFnProps) => {
        return (
          <Animated.View
            style={[
              isMobile ? styles.tabBarMobile : styles.tabBarDesktop,
              headerTransform,
            ]}>
            <View onLayout={onHeaderOnlyLayout}>{renderHeader?.()}</View>
            <View
              onLayout={onTabBarLayout}
              style={{
                // Render it immediately to measure it early since its size doesn't depend on the content.
                // However, keep it invisible until the header above stabilizes in order to prevent jumps.
                opacity: isHeaderReady ? 1 : 0,
                pointerEvents: isHeaderReady ? 'auto' : 'none',
              }}>
              <TabBar
                items={items}
                selectedPage={currentPage}
                onSelect={props.onSelect}
                onPressSelected={onCurrentPageSelected}
              />
            </View>
          </Animated.View>
        )
      },
      [
        items,
        isHeaderReady,
        renderHeader,
        headerTransform,
        currentPage,
        onCurrentPageSelected,
        isMobile,
        onTabBarLayout,
        onHeaderOnlyLayout,
      ],
    )

    // Ideally we'd call useAnimatedScrollHandler here but we can't safely do that
    // due to https://github.com/software-mansion/react-native-reanimated/issues/5345.
    // So instead we pass down a worklet, and individual pages will have to call it.
    const onScroll = React.useCallback(
      (e: NativeScrollEvent) => {
        'worklet'
        scrollY.value = e.contentOffset.y
      },
      [scrollY],
    )

    // props to pass into children render functions
    const childProps = React.useMemo<PagerWithHeaderChildParams>(() => {
      return {
        headerHeight,
        onScroll,
        isScrolledDown,
      }
    }, [headerHeight, onScroll, isScrolledDown])

    const onPageSelectedInner = React.useCallback(
      (index: number) => {
        setCurrentPage(index)
        onPageSelected?.(index)
      },
      [onPageSelected, setCurrentPage],
    )

    const onPageSelecting = React.useCallback(
      (index: number) => {
        setCurrentPage(index)
        if (scrollY.value > headerHeight) {
          scrollY.value = headerHeight
        }
        scrollY.value = withTiming(scrollYs.current[index] || 0, {
          duration: 170,
          easing: Easing.inOut(Easing.quad),
        })
      },
      [scrollY, setCurrentPage, scrollYs, headerHeight],
    )

    return (
      <Pager
        ref={ref}
        testID={testID}
        initialPage={initialPage}
        onPageSelected={onPageSelectedInner}
        onPageSelecting={onPageSelecting}
        renderTabBar={renderTabBar}
        tabBarPosition="top">
        {toArray(children)
          .filter(Boolean)
          .map((child, i) => {
            let output = null
            if (
              child != null &&
              // Defer showing content until we know it won't jump.
              isHeaderReady &&
              headerOnlyHeight > 0 &&
              tabBarHeight > 0
            ) {
              output = child(childProps)
            }
            // Pager children must be noncollapsible plain <View>s.
            return (
              <View key={i} collapsable={false}>
                {output}
              </View>
            )
          })}
      </Pager>
    )
  },
)

const styles = StyleSheet.create({
  tabBarMobile: {
    position: 'absolute',
    zIndex: 1,
    top: 0,
    left: 0,
    width: '100%',
  },
  tabBarDesktop: {
    position: 'absolute',
    zIndex: 1,
    top: 0,
    // @ts-ignore Web only -prf
    left: 'calc(50% - 299px)',
    width: 598,
  },
})

function toArray<T>(v: T | T[]): T[] {
  if (Array.isArray(v)) {
    return v
  }
  return [v]
}
