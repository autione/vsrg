const canvas = document.querySelector("#stats") as HTMLCanvasElement;
const context = canvas.getContext("2d")!;

type PlotPoint = {
  color: string;
  value: number;
};

type TimedPlotPoint = { time: number } & PlotPoint;

export let data = {
  visibleNotes: [] as TimedPlotPoint[],
  presses: [] as TimedPlotPoint[],
};

const length = 4;
const magnitude = 4;

let lastFrame = 0;
let clockTime = 0;
const renderStats = (timestamp: DOMHighResTimeStamp) => {
  const delta = (timestamp - lastFrame) / 1000;
  clockTime += delta;

  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  context.clearRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < data.visibleNotes.length; i += 1) {
    const point = data.visibleNotes[i];

    const x = (clockTime - point.time) * length;
    if (x > canvas.width) continue;

    const h = point.value * magnitude;
    const y = canvas.height - h;

    context.fillStyle = point.color;
    context.fillRect(x * length, y, length, 1);
  }

  context.save();
  context.globalAlpha = 0.5;
  for (let i = 0; i < data.presses.length; i += 1) {
    const point = data.presses[i];

    const x = (clockTime - point.time) * length;
    if (x > canvas.width) continue;

    context.fillStyle = point.color;
    context.fillRect(x * length, length * point.value, 2, length);
  }
  context.restore();

  lastFrame = timestamp;
  requestAnimationFrame(renderStats);
};

export const addPlotPoint = (key: keyof typeof data, point: PlotPoint) => data[key].push({ time: performance.now() / 1000, ...point });

export const initialize = () => {
  requestAnimationFrame(renderStats);
};
