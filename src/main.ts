import "./style.css";
import { clamp } from "./utils";
import JSZip, * as jszip from "jszip";

const dataInput = document.querySelector("#beatmap-data") as HTMLInputElement;
const difficulty = document.querySelector("#beatmap-difficulty") as HTMLSelectElement;

const scaleInput = document.querySelector("#scroll-scale") as HTMLInputElement;
const offsetInput = document.querySelector("#timing-offset") as HTMLInputElement;

const playfield = document.querySelector("#playfield") as HTMLCanvasElement;
const context = playfield.getContext("2d")!;

const dataParsed = document.querySelector("#beatmap-parsed") as HTMLTextAreaElement;
const dataOutput = document.querySelector("#beatmap-output") as HTMLTextAreaElement;

const audio = document.querySelector("#audio") as HTMLAudioElement;

const columnColors = ["#faa3af", "#fac6a3", "#faeda3", "#cfffaf", "#a3e6fa", "#e0baff", "#ffbfec"];

interface ConvertedChart {
  info: {
    song: {
      title: string;
      artist: string;
    };
    chart: {
      creator: string;
      difficulty: string;
    };
  };
  chart: {
    columns: number;
    hits: HitObject[];
    invalid?: boolean;
  };
}

interface HitObject {
  column: number;
  time: number;
  endTime?: number;
}

let trackTime = 0;
let lastFrame = 0;
let currentChart: ConvertedChart | undefined = undefined;

let currentArchive: JSZip | undefined = undefined;
let beatmapSet: { [filename: string]: string } = {};

let hits: number[] = [];
const presses: { [column: number]: { [time: number]: boolean } } = {};

const regex = {
  section: /^\[([A-Z]|[a-z])+\]$/gm,
  allData: /((([A-Z]|[a-z]|[0-9])+\s?:\s?.+)|(([A-Z]|[a-z]|[0-9]|\"|\.|\-)+,?)|\n)+/gm,
  keyedData: /((^([A-Z]|[a-z]|[0-9])+\s?:\s?.+)|\n)+/gm,
  indexedData: /(([A-Z]|[a-z]|[0-9]|\"|\.|\-)+,?)|\n+/gm,
};

const getSectionRegex = (section: string) => new RegExp(`^\\[${section}\\]$\n${regex.allData.source}`, "gm");

const parseSection = (data: string, section: string) => {
  data = data.replace(/\r\n/gm, "\n");

  const expr = getSectionRegex(section);
  const result = data.match(expr) ?? [];

  let sectionName = "Unknown";
  let isSectionArray = true;

  let arr: any[] = [];
  let obj: { [key: string]: any } = {};

  for (const match of result) {
    const lines = match.split("\n").filter((ln) => ln.trim().length > 0);

    for (const line of lines) {
      let type = "indexed";

      if (line.match(regex.section)) type = "header";
      if (line.match(regex.keyedData)) {
        isSectionArray = false;
        type = "keyed";
      }

      switch (type) {
        case "header":
          sectionName = line.replace(/(\[|\])/g, "");
          break;

        case "keyed":
          const [key, value] = line.split(":").map((e) => e.trim());
          obj[key] = value;
          break;

        case "indexed":
          arr.push(line.split(","));
          break;
      }
    }
  }

  return {
    name: sectionName,
    data: isSectionArray ? arr : obj,
  };
};

const loadBeatmap = (data: string) => {
  console.log("Reading string data...", data);
  if (!data.trim()) return console.warn("No beatmap data provided.");

  data = data.replace(/\/\/.+/, "");

  const parsed: { [key: string]: any } = {};
  const sections = data.match(regex.section) ?? [];

  for (const match of sections) {
    const results = parseSection(data, match.replace("[", "").replace("]", ""));
    parsed[results.name] = results.data;
  }

  playfield.innerHTML = "";
  console.log(parsed);

  const columns = Number(parsed.Difficulty.CircleSize);
  const output: ConvertedChart = {
    info: {
      song: {
        title: parsed.Metadata.TitleUnicode,
        artist: parsed.Metadata.ArtistUnicode,
      },
      chart: {
        creator: parsed.Metadata.Creator,
        difficulty: parsed.Metadata.Version,
      },
    },
    chart: {
      columns,
      hits: [],
      invalid: parsed.General.Mode != "3",
    },
  };

  for (let i = 0; i < parsed.HitObjects.length; i++) {
    const [x, y, time, type, hitSound, objectParams] = parsed.HitObjects[i];
    const [endTime, hitSample] = objectParams.split(":");

    const ci = clamp(Math.floor((Number(x) * columns) / 512), 0, columns - 1);

    output.chart.hits.push({
      column: ci + 1,
      time: Number(time),
      endTime: Number(endTime) || undefined,
    });
  }

  currentChart = output;
  hits = new Array(output.chart.columns).fill(0);

  dataParsed.value = JSON.stringify(parsed, undefined, 2);
  dataOutput.value = `return "${JSON.stringify(output).replace(/\"/g, '\\"')}"`;
  return {
    parsed,
    output,
  };
};

const renderPlayfield = (timestamp: DOMHighResTimeStamp) => {
  const delta = (timestamp - lastFrame) / 1000;
  trackTime += (audio.currentTime - trackTime) * delta * 30;

  playfield.width = playfield.clientWidth;
  playfield.height = playfield.clientHeight;

  context.clearRect(0, 0, playfield.width, playfield.height);

  if (!currentChart) {
    context.font = "48px 'IBM Plex Sans'";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#fff6";

    context.fillText("no chart loaded", playfield.width / 2, playfield.height / 2);
  } else {
    context.textAlign = "left";
    context.textBaseline = "top";
    context.fillStyle = "#fff";

    context.font = "16px 'IBM Plex Mono'";
    context.fillText(`${Math.floor(audio.currentTime * 1000)} / ${Math.floor(audio.duration * 1000)} (${Math.floor(trackTime * 1000)})`, 20, 40);

    context.font = "16px 'IBM Plex Sans'";
    context.fillText(`${currentChart.chart.hits.length} hit objects loaded`, 20, 20);

    const scale = scaleInput.valueAsNumber;
    const pressTime = offsetInput.valueAsNumber / 1000;

    const noteWidth = 72;
    const noteHeight = 28;
    const noteGap = 8;

    const stageWidth = noteWidth * currentChart.chart.columns + (noteGap * currentChart.chart.columns - 1);
    const stageAnchor = playfield.width / 2 - stageWidth / 2 - noteWidth - noteGap;

    const pressHeight = playfield.height - 120;

    context.textAlign = "right";
    context.fillText(`${pressTime} (${(delta * 1000).toFixed(2)}ms / ${(1 / delta).toFixed(1)} FPS)`, playfield.width - 20, 20);

    const fadeGradient = context.createLinearGradient(0, pressHeight, 0, playfield.height);
    fadeGradient.addColorStop(0, "#0000");
    fadeGradient.addColorStop(1, "#000");

    const colGradients = [];

    context.save();
    context.globalAlpha = 0.25;
    for (let i = 1; i <= currentChart.chart.columns; i += 1) {
      const x = stageAnchor + i * (noteWidth + noteGap);
      const colColor = columnColors[i - 1];

      context.fillStyle = colColor;
      context.fillRect(x, pressHeight - noteHeight / 2, noteWidth, noteHeight);

      // worst thing ever but it's gonna do for now lmao
      const colGradient = context.createLinearGradient(0, playfield.height - pressHeight, 0, pressHeight);
      colGradient.addColorStop(0, `${colColor}00`);
      colGradient.addColorStop(1, colColor);
      colGradients[i - 1] = colGradient;
    }
    context.restore();

    context.save();
    for (let i = 0; i < hits.length; i += 1) {
      let val = hits[i];

      context.fillStyle = columnColors[i];
      context.globalAlpha = Math.max(0, Math.min(1, val));

      const x = stageAnchor + (i + 1) * (noteWidth + noteGap);
      context.fillStyle = colGradients[i];
      context.fillRect(x, 0, noteWidth, pressHeight + noteHeight / 2);

      hits[i] -= delta * (val > 1 ? 1 : 5);
    }
    context.restore();

    for (const note of currentChart.chart.hits) {
      const timeSec = note.time / 1000;
      const relativeTime = timeSec - trackTime + pressTime;

      const x = stageAnchor + note.column * (noteWidth + noteGap);
      const y = pressHeight - relativeTime * (scale * noteHeight);
      const position: [number, number] = [x, y + noteHeight / 2];

      if (!(note.column in presses)) presses[note.column] = {};
      const pressed = note.time in presses[note.column];

      if (relativeTime <= -pressTime && !pressed) {
        let holdTime = 0;
        if (note.endTime && note.endTime > note.time) {
          holdTime = Math.max(0, (note.endTime - note.time) / 1000);
        }

        hits[note.column - 1] = 1 + holdTime;
        presses[note.column][note.time] = true;
      } else if (relativeTime > -pressTime && pressed) {
        delete presses[note.column][note.time];
      }

      if (pressed) {
        context.fillStyle = "#000";
      } else {
        context.fillStyle = columnColors[note.column - 1];
        context.fillRect(...position, noteWidth, noteHeight);
      }

      if (note.endTime) {
        const endTimeSec = note.endTime / 1000;
        const relativeEndTime = endTimeSec - trackTime;

        const endY = pressHeight - relativeEndTime * (scale * noteHeight);
        const endHeight = Math.max(0, y - endY);
        const holdPosition: [number, number] = [x + noteWidth / 4, endY + noteHeight / 2];

        context.save();
        context.globalAlpha = 0.5;
        context.fillRect(...holdPosition, noteWidth / 2, endHeight);
        context.restore();
      }

      context.fillStyle = "#000";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(`${Math.floor(relativeTime * 1000)}`, x + noteWidth / 2, y + noteHeight);
    }

    context.fillStyle = fadeGradient;
    context.fillRect(0, pressHeight, playfield.width, playfield.height - pressHeight);

    if (currentChart.chart.invalid) {
      context.font = "bold 24px 'IBM Plex Sans'";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = "#ffc65d";

      context.fillText("⚠️ not a mania chart ⚠️", playfield.width / 2, playfield.height - 40);
    }
  }

  lastFrame = timestamp;
  requestAnimationFrame(renderPlayfield);
};

const parseFile = async () => {
  currentChart = undefined;
  currentArchive = undefined;
  beatmapSet = {};

  const file = dataInput.files?.[0];
  if (!file) return;

  const archive = await jszip.loadAsync(await file.arrayBuffer());
  currentArchive = archive;

  const filenames = Object.keys(archive.files).filter((f) => f.endsWith(".osu"));
  difficulty.innerHTML = "";

  for (const filename of filenames) {
    const file = archive.file(filename);
    if (!file) continue;

    const content = await file.async("text");
    beatmapSet[filename] = content;

    const option = document.createElement("option");
    option.value = filename;
    option.innerText =
      filename
        .match(/\[.+\]/)?.[0]
        .replace("[", "")
        .replace("]", "") || filename;

    difficulty.appendChild(option);
  }

  updateDifficulty();
};

const updateDifficulty = async () => {
  const beatmap = beatmapSet[difficulty.value];
  if (beatmap) {
    const result = loadBeatmap(beatmap);
    console.log(result, currentArchive);
    if (!result || !currentArchive) return;

    const audioName = result.parsed.General.AudioFilename;
    const extracted = currentArchive.file(audioName);
    console.log(audioName, extracted);
    if (extracted) {
      audio.src = URL.createObjectURL(await extracted.async("blob"));
    }
  }
};

dataInput.addEventListener("change", parseFile);
difficulty.addEventListener("change", updateDifficulty);

addEventListener("DOMContentLoaded", () => {
  parseFile();
  updateDifficulty();

  audio.volume = 0.5;
});

requestAnimationFrame(renderPlayfield);
