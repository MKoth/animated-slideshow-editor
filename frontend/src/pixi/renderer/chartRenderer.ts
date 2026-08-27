import * as d3 from 'd3'
import type { ChartComponent, VisualConfig } from '../../engine/components'
import type { DataPoint } from '../../engine/dataSourceDefinition'
import type { SceneNode } from '../../engine'
import type { PixiContainer, PixiSprite, PixiTexture, RendererPixi } from './pixi'
import { svgToPixiTextureAsync } from './svgToPixiTexture'

export type ResolveDataSource = (dataSourceId: string) => readonly DataPoint[] | null

export const CHART_DEFAULT_WIDTH = 400
export const CHART_DEFAULT_HEIGHT = 300

const chartSpriteByContainer = new WeakMap<PixiContainer, PixiSprite>()

const DEFAULT_COLORS = [
  '#4e79a7',
  '#f28e2b',
  '#e15759',
  '#76b7b2',
  '#59a14f',
  '#edc948',
  '#b07aa1',
  '#ff9da7',
  '#9c755f',
  '#bab0ac',
]

function getColors(config: VisualConfig): string[] {
  return config.colors.length > 0 ? [...config.colors] : DEFAULT_COLORS
}

export function createChartContainer(pixi: RendererPixi, node: SceneNode): PixiContainer {
  const chart = node.components.chart
  if (!chart) {
    throw new Error(`Node "${node.name}" does not have a chart component`)
  }

  const group = new pixi.Container()
  group.label = `chart:${node.name}`
  group.pivot.set(CHART_DEFAULT_WIDTH / 2, CHART_DEFAULT_HEIGHT / 2)

  const texture = pixi.Texture.from('')
  const sprite = new pixi.Sprite(texture)
  sprite.label = 'chart-sprite'
  chartSpriteByContainer.set(group, sprite)
  group.addChild(sprite)

  return group
}

export function chartSpriteOf(container: PixiContainer): PixiSprite | undefined {
  return chartSpriteByContainer.get(container)
}

export async function rasterizeChart(
  pixi: RendererPixi,
  chart: ChartComponent,
  data: readonly DataPoint[],
  width: number,
  height: number,
): Promise<PixiTexture> {
  const svg = buildChartSvg(chart, data, width, height)
  return svgToPixiTextureAsync(pixi, svg)
}

export async function rebuildChartTexture(
  pixi: RendererPixi,
  sprite: PixiSprite,
  chart: ChartComponent,
  data: readonly DataPoint[],
  width: number,
  height: number,
): Promise<void> {
  const oldTexture = sprite.texture
  const texture = await rasterizeChart(pixi, chart, data, width, height)
  sprite.texture = texture
  if (oldTexture && !oldTexture.destroyed) {
    oldTexture.destroy()
  }
}

function buildChartSvg(
  chart: ChartComponent,
  data: readonly DataPoint[],
  width: number,
  height: number,
): SVGElement {
  const config = chart.visualConfig
  const colors = getColors(config)
  const legendHeight =
    config.legendPosition === 'top' || config.legendPosition === 'bottom' ? 30 : 0
  const legendWidth =
    config.legendPosition === 'left' || config.legendPosition === 'right' ? 120 : 0

  const margin = { top: 20, right: 20, bottom: 40, left: 50 }
  const chartWidth = width - margin.left - margin.right - legendWidth
  const chartHeight = height - margin.top - margin.bottom - legendHeight

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', String(width))
  svg.setAttribute('height', String(height))
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  svg.style.fontFamily = config.fontFamily
  svg.style.fontSize = `${config.fontSize}px`

  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  bg.setAttribute('width', String(width))
  bg.setAttribute('height', String(height))
  bg.setAttribute('fill', 'white')
  svg.appendChild(bg)

  const legendGroup = createLegendGroup(
    config.legendPosition,
    width,
    height,
    margin,
    legendWidth,
    legendHeight,
  )
  if (legendGroup) {
    const seriesNames = [...new Set(data.map((d) => d.series ?? d.label))]
    if (seriesNames.length > 1) {
      populateLegend(legendGroup, seriesNames, colors, config.legendPosition, config)
    }
    svg.appendChild(legendGroup)
  }

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  g.setAttribute('transform', `translate(${margin.left},${margin.top})`)
  svg.appendChild(g)

  switch (chart.chartType) {
    case 'bar':
      renderBarChart(g, data, chart, colors, chartWidth, chartHeight)
      break
    case 'line':
      renderLineChart(g, data, chart, colors, chartWidth, chartHeight)
      break
    case 'pie':
      renderPieChart(g, data, colors, chartWidth, chartHeight)
      break
    case 'area':
      renderAreaChart(g, data, chart, colors, chartWidth, chartHeight)
      break
  }

  return svg
}

function renderBarChart(
  g: SVGGElement,
  data: readonly DataPoint[],
  chart: ChartComponent,
  colors: string[],
  width: number,
  height: number,
): void {
  const config = chart.visualConfig
  const seriesGroups = groupBySeries(data)
  const seriesNames = [...seriesGroups.keys()]
  const useGrouping = seriesNames.length > 1 && seriesNames[0] !== ''

  const labels = [...new Set(data.map((d) => d.label))]
  const allValues = data.map((d) => d.value)
  const yMin = chart.axisMin ?? 0
  const yMax = chart.axisMax ?? d3.max(allValues) ?? 1

  const x0 = d3.scaleBand().domain(labels).range([0, width]).padding(0.2)

  if (useGrouping) {
    const x1 = d3.scaleBand().domain(seriesNames).range([0, x0.bandwidth()]).padding(0.1)
    const y = d3.scaleLinear().domain([yMin, yMax]).nice().range([height, 0])

    addAxisX(g, x0, height, config)
    addAxisY(g, y, width, config)

    for (const [seriesIdx, seriesName] of seriesNames.entries()) {
      const points = seriesGroups.get(seriesName) ?? []
      const color = colors[seriesIdx % colors.length]

      for (const point of points) {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
        rect.setAttribute('x', String((x0(point.label) ?? 0) + (x1(seriesName) ?? 0)))
        rect.setAttribute('y', String(y(point.value)))
        rect.setAttribute('width', String(x1.bandwidth()))
        rect.setAttribute('height', String(height - y(point.value)))
        rect.setAttribute('fill', color)
        g.appendChild(rect)
      }
    }
  } else {
    const y = d3.scaleLinear().domain([yMin, yMax]).nice().range([height, 0])

    addAxisX(g, x0, height, config)
    addAxisY(g, y, width, config)

    for (const [i, point] of data.entries()) {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      rect.setAttribute('x', String(x0(point.label) ?? 0))
      rect.setAttribute('y', String(y(point.value)))
      rect.setAttribute('width', String(x0.bandwidth()))
      rect.setAttribute('height', String(height - y(point.value)))
      rect.setAttribute('fill', colors[i % colors.length])
      g.appendChild(rect)
    }
  }
}

function renderLineChart(
  g: SVGGElement,
  data: readonly DataPoint[],
  chart: ChartComponent,
  colors: string[],
  width: number,
  height: number,
): void {
  const config = chart.visualConfig
  const seriesGroups = groupBySeries(data)
  const seriesNames = [...seriesGroups.keys()]
  const useGrouping = seriesNames.length > 1 && seriesNames[0] !== ''

  const allValues = data.map((d) => d.value)
  const yMin = chart.axisMin ?? 0
  const yMax = chart.axisMax ?? d3.max(allValues) ?? 1

  const labels = [...new Set(data.map((d) => d.label))]
  const x = d3.scalePoint().domain(labels).range([0, width]).padding(0.5)
  const y = d3.scaleLinear().domain([yMin, yMax]).nice().range([height, 0])

  addAxisX(g, x as unknown as d3.ScaleBand<string>, height, config)
  addAxisY(g, y, width, config)

  if (useGrouping) {
    for (const [seriesIdx, seriesName] of seriesNames.entries()) {
      const points = seriesGroups.get(seriesName) ?? []
      const color = colors[seriesIdx % colors.length]

      const line = d3
        .line<DataPoint>()
        .x((d) => x(d.label) ?? 0)
        .y((d) => y(d.value))
        .curve(d3.curveMonotoneX)

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', line(points as DataPoint[]) ?? '')
      path.setAttribute('fill', 'none')
      path.setAttribute('stroke', color)
      path.setAttribute('stroke-width', '2')
      g.appendChild(path)

      for (const point of points) {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        circle.setAttribute('cx', String(x(point.label) ?? 0))
        circle.setAttribute('cy', String(y(point.value)))
        circle.setAttribute('r', '3')
        circle.setAttribute('fill', color)
        g.appendChild(circle)
      }
    }
  } else {
    const line = d3
      .line<DataPoint>()
      .x((d) => x(d.label) ?? 0)
      .y((d) => y(d.value))
      .curve(d3.curveMonotoneX)

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', line(data as DataPoint[]) ?? '')
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', colors[0])
    path.setAttribute('stroke-width', '2')
    g.appendChild(path)

    for (const point of data) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      circle.setAttribute('cx', String(x(point.label) ?? 0))
      circle.setAttribute('cy', String(y(point.value)))
      circle.setAttribute('r', '3')
      circle.setAttribute('fill', colors[0])
      g.appendChild(circle)
    }
  }
}

function renderPieChart(
  g: SVGGElement,
  data: readonly DataPoint[],
  colors: string[],
  width: number,
  height: number,
): void {
  const radius = Math.min(width, height) / 2
  const centerX = width / 2
  const centerY = height / 2

  const pie = d3
    .pie<DataPoint>()
    .value((d) => d.value)
    .sort(null)
  const arcs = pie(data as DataPoint[])

  const arc = d3.arc<d3.PieArcDatum<DataPoint>>().innerRadius(0).outerRadius(radius)

  const pieGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  pieGroup.setAttribute('transform', `translate(${centerX},${centerY})`)
  g.appendChild(pieGroup)

  for (const [i, arcData] of arcs.entries()) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', arc(arcData) ?? '')
    path.setAttribute('fill', colors[i % colors.length])
    path.setAttribute('stroke', 'white')
    path.setAttribute('stroke-width', '1')
    pieGroup.appendChild(path)
  }
}

function renderAreaChart(
  g: SVGGElement,
  data: readonly DataPoint[],
  chart: ChartComponent,
  colors: string[],
  width: number,
  height: number,
): void {
  const config = chart.visualConfig
  const seriesGroups = groupBySeries(data)
  const seriesNames = [...seriesGroups.keys()]
  const useGrouping = seriesNames.length > 1 && seriesNames[0] !== ''

  const allValues = data.map((d) => d.value)
  const yMin = chart.axisMin ?? 0
  const yMax = chart.axisMax ?? d3.max(allValues) ?? 1

  const labels = [...new Set(data.map((d) => d.label))]
  const x = d3.scalePoint().domain(labels).range([0, width]).padding(0.5)
  const y = d3.scaleLinear().domain([yMin, yMax]).nice().range([height, 0])

  addAxisX(g, x as unknown as d3.ScaleBand<string>, height, config)
  addAxisY(g, y, width, config)

  if (useGrouping) {
    for (const [seriesIdx, seriesName] of seriesNames.entries()) {
      const points = seriesGroups.get(seriesName) ?? []
      const color = colors[seriesIdx % colors.length]

      const area = d3
        .area<DataPoint>()
        .x((d) => x(d.label) ?? 0)
        .y0(height)
        .y1((d) => y(d.value))
        .curve(d3.curveMonotoneX)

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', area(points as DataPoint[]) ?? '')
      path.setAttribute('fill', color)
      path.setAttribute('opacity', '0.6')
      g.appendChild(path)

      const line = d3
        .line<DataPoint>()
        .x((d) => x(d.label) ?? 0)
        .y((d) => y(d.value))
        .curve(d3.curveMonotoneX)

      const linePath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      linePath.setAttribute('d', line(points as DataPoint[]) ?? '')
      linePath.setAttribute('fill', 'none')
      linePath.setAttribute('stroke', color)
      linePath.setAttribute('stroke-width', '2')
      g.appendChild(linePath)
    }
  } else {
    const area = d3
      .area<DataPoint>()
      .x((d) => x(d.label) ?? 0)
      .y0(height)
      .y1((d) => y(d.value))
      .curve(d3.curveMonotoneX)

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', area(data as DataPoint[]) ?? '')
    path.setAttribute('fill', colors[0])
    path.setAttribute('opacity', '0.6')
    g.appendChild(path)

    const line = d3
      .line<DataPoint>()
      .x((d) => x(d.label) ?? 0)
      .y((d) => y(d.value))
      .curve(d3.curveMonotoneX)

    const linePath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    linePath.setAttribute('d', line(data as DataPoint[]) ?? '')
    linePath.setAttribute('fill', 'none')
    linePath.setAttribute('stroke', colors[0])
    linePath.setAttribute('stroke-width', '2')
    g.appendChild(linePath)
  }
}

function addAxisX(
  g: SVGGElement,
  scale: d3.ScaleBand<string>,
  height: number,
  config: VisualConfig,
): void {
  const axis = d3.axisBottom(scale)
  const axisG = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  axisG.setAttribute('transform', `translate(0,${height})`)
  axisG.setAttribute('class', 'x-axis')
  const selection = d3.select(axisG)
  axis(selection as unknown as d3.Selection<SVGGElement, unknown, null, undefined>)
  if (config.axisLabels.x) {
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    label.setAttribute('x', String(scale.range()[1] / 2))
    label.setAttribute('y', '35')
    label.setAttribute('text-anchor', 'middle')
    label.setAttribute('font-size', String(config.fontSize))
    label.textContent = config.axisLabels.x
    axisG.appendChild(label)
  }
  g.appendChild(axisG)
}

function addAxisY(
  g: SVGGElement,
  scale: d3.ScaleLinear<number, number>,
  width: number,
  config: VisualConfig,
): void {
  const axis = d3.axisLeft(scale)
  const axisG = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  axisG.setAttribute('class', 'y-axis')
  const selection = d3.select(axisG)
  axis(selection as unknown as d3.Selection<SVGGElement, unknown, null, undefined>)
  if (config.axisLabels.y) {
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    label.setAttribute('transform', 'rotate(-90)')
    label.setAttribute('x', String(-width / 2))
    label.setAttribute('y', '-40')
    label.setAttribute('text-anchor', 'middle')
    label.setAttribute('font-size', String(config.fontSize))
    label.textContent = config.axisLabels.y
    axisG.appendChild(label)
  }
  g.appendChild(axisG)
}

function createLegendGroup(
  position: VisualConfig['legendPosition'],
  width: number,
  height: number,
  margin: { top: number; right: number; bottom: number; left: number },
  legendWidth: number,
  legendHeight: number,
): SVGGElement | null {
  if (position === 'none') return null

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  g.setAttribute('class', 'legend')

  let x = 0
  let y = 0

  switch (position) {
    case 'top':
      x = margin.left
      y = margin.top - 10
      break
    case 'bottom':
      x = margin.left
      y = height - margin.bottom + legendHeight - 5
      break
    case 'left':
      x = 5
      y = margin.top
      break
    case 'right':
      x = width - margin.right - legendWidth + 5
      y = margin.top
      break
  }

  g.setAttribute('transform', `translate(${x},${y})`)
  return g
}

function populateLegend(
  legendGroup: SVGGElement,
  seriesNames: readonly string[],
  colors: string[],
  position: VisualConfig['legendPosition'],
  config: VisualConfig,
): void {
  const isHorizontal = position === 'top' || position === 'bottom'

  for (const [i, name] of seriesNames.entries()) {
    const item = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    const offsetX = isHorizontal ? i * 100 : 0
    const offsetY = isHorizontal ? 0 : i * 20
    item.setAttribute('transform', `translate(${offsetX},${offsetY})`)

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('width', '12')
    rect.setAttribute('height', '12')
    rect.setAttribute('fill', colors[i % colors.length])
    item.appendChild(rect)

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    text.setAttribute('x', '16')
    text.setAttribute('y', '10')
    text.setAttribute('font-size', String(config.fontSize))
    text.textContent = name
    item.appendChild(text)

    legendGroup.appendChild(item)
  }
}

function groupBySeries(data: readonly DataPoint[]): Map<string, readonly DataPoint[]> {
  const groups = new Map<string, readonly DataPoint[]>()
  for (const point of data) {
    const key = point.series ?? ''
    const existing = groups.get(key)
    if (existing) {
      groups.set(key, [...existing, point])
    } else {
      groups.set(key, [point])
    }
  }
  return groups
}
