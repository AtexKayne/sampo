import { useId } from "react";

const METALS = {
  bronze: { light: "#ffe2c2", mid: "#cd8d52", dark: "#6b3b17" },
  silver: { light: "#ffffff", mid: "#c3cad4", dark: "#58616e" },
  gold: { light: "#fff5c4", mid: "#e8b53e", dark: "#7a4f08" },
};

const CREAM = "#fff8e8";

const LOOKS = {
  "first-step": { metal: "bronze", field: ["#63d6b9", "#0b564d"] },
  five: { metal: "bronze", field: ["#3c9e8f", "#0b3d38"] },
  ten: { metal: "silver", field: ["#4f7fd8", "#132a5e"] },
  fifty: { metal: "gold", field: ["#2fae72", "#0a432a"] },
  hundred: { metal: "gold", field: ["#d63a4a", "#4f0814"] },
  "no-rest": { metal: "silver", field: ["#ff7b7b", "#86192a"] },
  "busy-month": { metal: "silver", field: ["#6f80f2", "#232c75"] },
  "legendary-month": { metal: "gold", field: ["#a774f2", "#36156e"] },
  impossible: { metal: "gold", field: ["#5560a8", "#0a0c24"] },
  "two-a-day": { metal: "bronze", field: ["#ffab63", "#9b4115"] },
  weekend: { metal: "bronze", field: ["#72cdff", "#155f9b"] },
  monday: { metal: "bronze", field: ["#ffc66b", "#bb4f26"] },
  early: { metal: "silver", field: ["#fff3c4", "#ffb067", "#d9607c"], center: [50, 90] },
  late: { metal: "silver", field: ["#5a4ba6", "#150f36"], center: [70, 20] },
  "long-set": { metal: "silver", field: ["#4db4da", "#10465f"] },
  "lone-wolf": { metal: "silver", field: ["#3f5ea3", "#0c1330"], center: [62, 32] },
  "solo-fine": { metal: "silver", field: ["#e872b7", "#6f1b54"] },
  "first-pair": { metal: "bronze", field: ["#ff93a7", "#9c2c49"] },
  circle: { metal: "silver", field: ["#f4b444", "#8d500d"] },
  "wide-circle": { metal: "gold", field: ["#ff9e4a", "#7d300a"] },
  loyal: { metal: "silver", field: ["#ff7ca4", "#861d47"] },
  inseparable: { metal: "gold", field: ["#ff5f80", "#6c0c29"] },
  "three-weeks": { metal: "bronze", field: ["#7fd57b", "#235f25"] },
  "two-months": { metal: "silver", field: ["#5aa8ff", "#174a88"] },
  "dance-master": { metal: "gold", field: ["#7d5fff", "#25136b"] },
  sloth: { metal: "bronze", field: ["#9be08f", "#1d5e3c"], center: [40, 30] },
  "grand-sloth": { metal: "gold", field: ["#6fd0a0", "#0d3f2f"], center: [40, 30] },
  "cunning-carburetor": { metal: "gold", field: ["#ffeaa6", "#e2a83c"], center: [44, 30] },
};

function star(cx, cy, outer, inner, points = 5) {
  const coords = [];
  for (let index = 0; index < points * 2; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (index * Math.PI) / points;
    coords.push(`${(cx + Math.cos(angle) * radius).toFixed(2)} ${(cy + Math.sin(angle) * radius).toFixed(2)}`);
  }
  return `M${coords.join("L")}Z`;
}

function point(angle, radius) {
  const radians = (angle * Math.PI) / 180;
  return [32 + Math.cos(radians) * radius, 32 + Math.sin(radians) * radius];
}

function beads(color) {
  return Array.from({ length: 28 }, (_, index) => {
    const [cx, cy] = point((index / 28) * 360 - 90, 27.15);
    return <circle key={index} cx={cx.toFixed(2)} cy={cy.toFixed(2)} r="0.72" fill={color} stroke="none" />;
  });
}

function Laurel({ side, paint }) {
  const radius = 18.2;
  const from = side < 0 ? 124 : 56;
  const to = side < 0 ? 236 : -56;
  const [startX, startY] = point(from, radius);
  const [endX, endY] = point(to, radius);
  const leaves = [];
  for (let index = 0; index < 6; index += 1) {
    const angle = from + ((to - from) * (index + 0.5)) / 6;
    const [x, y] = point(angle, radius);
    const along = angle - side * 90;
    for (const turn of [1, -1]) {
      leaves.push(
        <path
          key={`${index}${turn}`}
          d="M0 0Q2.1-1.75 4.6 0Q2.1 1.75 0 0Z"
          transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${(along + side * turn * 38).toFixed(1)})`}
        />,
      );
    }
  }
  const [tipX, tipY] = point(to, radius);
  leaves.push(
    <path key="tip" d="M0 0Q2.1-1.75 4.6 0Q2.1 1.75 0 0Z" transform={`translate(${tipX.toFixed(2)} ${tipY.toFixed(2)}) rotate(${(to - side * 90).toFixed(1)})`} />,
  );
  return (
    <g fill={paint.metal} stroke={paint.edge} strokeWidth="0.35">
      <path d={`M${startX.toFixed(2)} ${startY.toFixed(2)}A${radius} ${radius} 0 0 ${side < 0 ? 1 : 0} ${endX.toFixed(2)} ${endY.toFixed(2)}`} fill="none" stroke={paint.metal} strokeWidth="1.1" />
      {leaves}
    </g>
  );
}

function Crown({ x, y, scale = 1, paint }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} stroke={paint.edge} strokeWidth="0.55">
      <path d="M-5.6 2.6-6.4-3.6-2.8-.6 0-5.2 2.8-.6 6.4-3.6 5.6 2.6Z" fill={paint.metal} />
      <path d="M-5.6 2.6h11.2" />
      <circle cx="0" cy="-5.2" r="0.9" fill="#ff5a6e" />
      <circle cx="-6.4" cy="-3.6" r="0.75" fill="#7ce0ff" />
      <circle cx="6.4" cy="-3.6" r="0.75" fill="#7ce0ff" />
      <circle cx="0" cy="0.9" r="0.85" fill="#ff5a6e" />
    </g>
  );
}

function countMark(label, size, stars) {
  return (paint) => (
    <>
      <Laurel side={-1} paint={paint} />
      <Laurel side={1} paint={paint} />
      {stars.map(([x, y, r]) => (
        <path key={`${x}${y}`} d={star(x, y, r, r * 0.42)} fill={paint.metal} stroke={paint.edge} strokeWidth="0.45" />
      ))}
      <text
        x="32"
        y="33.6"
        textAnchor="middle"
        dominantBaseline="central"
        fill={paint.metal}
        stroke={paint.edge}
        strokeWidth="1.4"
        paintOrder="stroke"
        fontFamily='"Manrope", system-ui, sans-serif'
        fontSize={size}
        fontWeight="800"
        letterSpacing="-0.6"
      >
        {label}
      </text>
    </>
  );
}

const FUR = "#e6cfa7";
const FUR_LIGHT = "#f7ead0";
const FACE = "#fff5e0";
const BROWN = "#3a2716";
const BARK = "#8c5a2b";
const LEAF = "#7fd06f";

function Sloth({ grand, paint }) {
  return (
    <g stroke={BROWN} strokeWidth="1.25">
      <path d="M49.6 12.6c3.2-2.4 7-2 8.8.2-3.2 2-6.6 2.2-8.8-.2Z" fill={LEAF} />
      <path d="M11 31.8c-1.8-3.2-1-6.6 1.4-8.2 1.4 3 1 6.2-1.4 8.2Z" fill={LEAF} />
      <path d="M16.4 28.4C12.6 34 12.8 45 20 51.5c7 6 20.5 5 27-2.5 4-5 4-11 1-15.5l-6.4-10.9-5.4.2c-1.6 5.2-2.8 10.2-4.6 14.8-2.6-.6-5-3.6-8.2-10.6Z" fill={FUR} />
      <path d="M21.4 44.4c2.4-2.6 7-3.2 10.6-1.6 3 1.4 4.2 4.4 3.4 7.4-1 3-4.2 4.8-7.8 4.6-3.6-.2-6.2-1.8-7.2-4.4-.6-2-.2-4.2 1-6Z" fill={FUR_LIGHT} stroke="none" />
      <path d="M17.6 37.4c1.4 2.6 1.6 5.2.8 7.6M45.6 45.4c-.8 2-2 3.6-3.6 4.6M26.4 49.6c1.4.8 3 1 4.6.6" fill="none" strokeWidth="0.85" />
      <path d="M19.2 31.4c-1.6 4-1.4 8.4.8 12.4" stroke={FUR_LIGHT} strokeWidth="1.4" fill="none" />
      <path d="M4 31.6 59.4 10.2l1.9 4.8L5.9 36.4Z" fill={BARK} />
      <path d="M12.6 31.4l3.6-1.4M27.4 25.6l4.6-1.8M47.4 17.8l3.6-1.4" stroke="#5a3814" strokeWidth="0.8" />
      <ellipse cx="20" cy="28.6" rx="3.7" ry="2.7" transform="rotate(-21 20 28.6)" fill={FUR} />
      <ellipse cx="38.4" cy="21.6" rx="3.7" ry="2.7" transform="rotate(-21 38.4 21.6)" fill={FUR} />
      <path d="M17.4 27.6c-.6-1.6 0-3.2 1.4-3.8M19.8 26.8c-.4-1.6.2-3.2 1.6-3.6M22.2 25.8c-.2-1.6.6-2.8 2-3.2" fill="none" strokeWidth="1.1" />
      <path d="M35.8 20.6c-.6-1.6 0-3.2 1.4-3.8M38.2 19.8c-.4-1.6.2-3.2 1.6-3.6M40.6 18.8c-.2-1.6.6-2.8 2-3.2" fill="none" strokeWidth="1.1" />
      <circle cx="42.5" cy="36" r="8.8" fill={FUR} />
      <ellipse cx="42.5" cy="36.8" rx="7.1" ry="6.3" fill={FACE} stroke="none" />
      <path d="M35.6 35.6c-.2-3.2 2.8-4.6 5.2-3 1 .7 2.4.7 3.4 0 2.4-1.6 5.4-.2 5.2 3-.2 3.2-2.8 5.2-5 5.8h-3.8c-2.2-.6-4.8-2.6-5-5.8Z" fill={BROWN} stroke="none" />
      <ellipse cx="42.5" cy="39.3" rx="2.9" ry="2.1" fill={FACE} stroke="none" />
      <path d="M37.6 35.8q1.4-1.6 2.8 0M44.6 35.8q1.4-1.6 2.8 0" stroke={FACE} strokeWidth="1" fill="none" />
      <ellipse cx="42.5" cy="38.5" rx="1.25" ry="0.85" fill={BROWN} stroke="none" />
      <path d="M41.2 40.2q1.3.9 2.6 0" fill="none" strokeWidth="0.85" />
      <circle cx="37" cy="40" r="1.15" fill="#ff8f8f" fillOpacity="0.55" stroke="none" />
      <circle cx="48" cy="40" r="1.15" fill="#ff8f8f" fillOpacity="0.55" stroke="none" />
      {grand ? (
        <>
          <Crown x={42.5} y={26.2} scale={0.9} paint={paint} />
          <path d="M48.4 28.4h2.6l-2.6 2.8h2.6M51.8 23.2h1.8l-1.8 2h1.8" stroke={CREAM} strokeWidth="0.9" fill="none" />
        </>
      ) : null}
    </g>
  );
}

const CAPY = "#b9824f";
const CAPY_LIGHT = "#d4a271";
const CAPY_DARK = "#8a5a32";
const CAPY_NOSE = "#8a7262";
const CAPY_MUZZLE = "#f4dfc1";
const CAPY_EAR = "#e98b7f";

function Capybara() {
  return (
    <g stroke={BROWN} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" transform="translate(1.6 -1)">
      <circle cx="27.9" cy="16" r="3" fill={CAPY} />
      <circle cx="27.9" cy="16.2" r="1.6" fill={CAPY_DARK} stroke="none" />
      <path d="M12.9 31.4C12.6 28.6 13.6 27 15.4 26.2 19 23.6 25.8 18.6 31.6 16.6c4.8-1.6 10-.4 12.8 3.4 2.6 3.4 4 8.4 3.8 13-.2 4.6-1.4 8.4-3.4 11l-1.2 3.2-1.8-1.4-1.4 3.6-1.8-1.8-1.8 3.4-1.8-2.4-2 2.8-1.6-2.8-2.2 2-1-2.8-2.4 1.4-.4-2.8c-1.4-1.6-2-3.4-2.6-4.8-2.8-.6-6-2-8-4.2-1.4-1.6-1.8-3.8-1.9-6Z" fill={CAPY} />
      <path d="M24.6 21.4c1.4-1.2 3-2 4.8-2.4" fill="none" stroke={CAPY_LIGHT} strokeWidth="1.4" />
      <path d="M13 31.2c-.2-2.6 1-4.2 2.8-5 2.8-1.4 6-1.6 7.8-.6-1.2 1.4-2.4 2.6-2.6 4.6-.2 2.4-2 3.8-4.2 3.8s-3.6-1.2-3.8-2.8Z" fill={CAPY_NOSE} stroke="none" />
      <path d="M14.6 35.8c1.6-1.2 3.4-1.4 5.2-1.2 2.8-.8 5.8-1.2 7.6-.6-1.4 2.6-2.8 5.4-4.4 7.6-3-.6-6.2-2-8.2-4.2Z" fill={CAPY_MUZZLE} stroke="none" />
      <path d="M12.9 31.4C12.6 28.6 13.6 27 15.4 26.2" fill="none" />
      <ellipse cx="17.4" cy="30.8" rx="1.3" ry="0.9" transform="rotate(-25 17.4 30.8)" fill={BROWN} stroke="none" />
      <path d="M17.4 33.2l.4 3.2M15.6 37c2.4 1.6 5.4 2 8 1.2" fill="none" strokeWidth="1" />
      <path d="M28.9 25.3l4.8-.8c.3 1.9-.7 3.3-2.3 3.3s-2.5-1-2.5-2.5Z" fill={BROWN} stroke="none" />
      <path d="M28.4 25.6l5.8-1.2" fill="none" strokeWidth="1.3" />
      <circle cx="32.2" cy="25.9" r="0.45" fill="#fff" stroke="none" />
      <circle cx="40" cy="16.8" r="4" fill={CAPY} />
      <circle cx="40.6" cy="17.6" r="2.4" fill={CAPY_EAR} stroke="none" />
      <path d="M36.2 18.4c1.2-.6 2.4-.4 3.2.4" fill="none" stroke={CAPY} strokeWidth="1.6" />
      <path d="M28 37c3.4 1.4 6 3.6 7.4 6.4M44.2 32.6l1.6 1.4M43.4 37.2l1.8 1.2" fill="none" strokeWidth="0.9" />
      <path d="M18.4 34.4l-7.6-.4M18.6 35.4l-7.4 2.2M19.2 36.4l-6.4 4" fill="none" strokeWidth="0.6" />
    </g>
  );
}

const SKIN = "#ffd7b5";
const GOLD = "#ffc53d";
const RED = "#ff4d6d";
const HEART = "M0 3.2C-2.6 1.6-4.4.2-4.4-1.6c0-1.4 1-2.4 2.2-2.4.9 0 1.7.5 2.2 1.3.5-.8 1.3-1.3 2.2-1.3 1.2 0 2.2 1 2.2 2.4 0 1.8-1.8 3.2-4.4 4.8Z";

const PEOPLE = ["#4d8dff", "#ff5a7a", "#2fbf71", "#9b5de5", "#fff1c4", "#00b4d8", "#f15bb5", "#43aa8b", "#7ad3ff", "#c77dff"];

function Limb({ d, color, width = 1.4 }) {
  return (
    <>
      <path d={d} stroke={BROWN} strokeWidth={width + 1.4} fill="none" />
      <path d={d} stroke={color} strokeWidth={width} fill="none" />
    </>
  );
}

function Figure({ x, y, scale = 1, color, arms, legs, headphones }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} stroke={BROWN} strokeWidth="0.9">
      {[...legs, ...arms].map((d) => <Limb key={d} d={d} color={color} width={2.2} />)}
      <path d="M-3.2-16Q0-17.2 3.2-16L2.4-7.6H-2.4Z" fill={color} />
      <circle cx="0" cy="-21" r="3.5" fill={color} />
      <path d="M-1.9-22.6a2.2 2.2 0 0 1 1.6-1.2" stroke="#fff" strokeOpacity="0.8" strokeWidth="0.8" fill="none" />
      {headphones ? (
        <>
          <path d="M-4.1-21.4a4.1 4.1 0 0 1 8.2 0" stroke="#2a2140" strokeWidth="1.1" fill="none" />
          <rect x="-5.3" y="-22.8" width="2.1" height="3.4" rx="0.9" fill={GOLD} strokeWidth="0.6" />
          <rect x="3.2" y="-22.8" width="2.1" height="3.4" rx="0.9" fill={GOLD} strokeWidth="0.6" />
        </>
      ) : null}
    </g>
  );
}

function Face({ y = 0 }) {
  return (
    <>
      <circle cx="-1.1" cy={y} r="0.4" fill={BROWN} stroke="none" />
      <circle cx="1.3" cy={y} r="0.4" fill={BROWN} stroke="none" />
      <path d={`M-.9 ${y + 1.4}q1 .8 2 0`} strokeWidth="0.6" fill="none" />
      <circle cx="-2" cy={y + 1.2} r="0.6" fill="#ff8f8f" fillOpacity="0.6" stroke="none" />
      <circle cx="2.4" cy={y + 1.2} r="0.6" fill="#ff8f8f" fillOpacity="0.6" stroke="none" />
    </>
  );
}

function Dancer({ x, y, scale = 1, flip, follow, outfit, hair, arms, legs, headphones }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -scale : scale} ${scale})`} stroke={BROWN} strokeWidth="0.9">
      {legs.map((d) => <Limb key={d} d={d} color={follow ? SKIN : "#2d3250"} />)}
      {arms.map((d) => <Limb key={d} d={d} color={SKIN} />)}
      {follow ? (
        <>
          <path d="M-2.8-15.8Q0-16.8 2.8-15.8L2.2-10H-2.2Z" fill={outfit} />
          <path d="M-2.4-10.6H2.4L6.2-3.6Q0-1.4-6.2-3.6Z" fill={outfit} />
          <circle cx="-2.6" cy="-22.6" r="1.7" fill={hair} />
        </>
      ) : (
        <path d="M-3.4-15.8Q0-17 3.4-15.8L2.8-7.6H-2.8Z" fill={outfit} />
      )}
      <circle cx="0" cy="-19.6" r="3.3" fill={SKIN} />
      <path d="M-3.4-19.4c-.6-3.2 1.2-5 3.4-5 2.4 0 4 1.8 3.4 4.8-.8-1.2-2.2-2-3.8-2.2-1.2.6-2.2 1.4-3 2.4Z" fill={hair} />
      <Face y={-19.4} />
      {headphones ? (
        <>
          <path d="M-3.9-20.2a3.9 3.9 0 0 1 7.8 0" stroke="#2a2140" strokeWidth="1.1" fill="none" />
          <rect x="-5" y="-21.6" width="2" height="3.2" rx="0.9" fill="#ff5ea8" strokeWidth="0.6" />
          <rect x="3" y="-21.6" width="2" height="3.2" rx="0.9" fill="#ff5ea8" strokeWidth="0.6" />
        </>
      ) : null}
    </g>
  );
}

function Avatar({ x, y, scale = 1, color }) {
  return (
    <g transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale})`} stroke={BROWN} strokeWidth="0.8">
      <path d="M-4.6 5.4C-4.6 2.2-2.6.6 0 .6s4.6 1.6 4.6 4.8Z" fill={color} />
      <circle cy="-3" r="3.1" fill={color} />
      <path d="M-1.7-4.4a1.9 1.9 0 0 1 1.4-1" stroke="#fff" strokeOpacity="0.8" strokeWidth="0.7" fill="none" />
    </g>
  );
}

function Ring({ count, radius, scale }) {
  return Array.from({ length: count }, (_, index) => {
    const [x, y] = point(-90 + (index * 360) / count, radius);
    return <Avatar key={index} x={x} y={y} scale={scale} color={PEOPLE[index % PEOPLE.length]} />;
  });
}

function Calendar({ x, y, angle, header, children }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`} stroke={BROWN} strokeWidth="1.1">
      <rect x="-9" y="-10" width="18" height="20" rx="2.4" fill={CREAM} />
      <path d="M-9-7.6a2.4 2.4 0 0 1 2.4-2.4h13.2a2.4 2.4 0 0 1 2.4 2.4V-4H-9Z" fill={header} />
      <path d="M-4.4-11.8v3.4M4.4-11.8v3.4" strokeWidth="1.6" />
      {children}
    </g>
  );
}

function Sparkle({ x, y, size = 1, color = "#fff6d0" }) {
  return (
    <path
      d={`M${x} ${y - 2.4 * size}Q${x + 0.4 * size} ${y - 0.4 * size} ${x + 2.4 * size} ${y}Q${x + 0.4 * size} ${y + 0.4 * size} ${x} ${y + 2.4 * size}Q${x - 0.4 * size} ${y + 0.4 * size} ${x - 2.4 * size} ${y}Q${x - 0.4 * size} ${y - 0.4 * size} ${x} ${y - 2.4 * size}Z`}
      fill={color}
      stroke="none"
    />
  );
}

const SCENES = {
  "first-step": (
    <>
      <path d="M27 4h10l12 46H15Z" fill="#fff6d0" fillOpacity="0.2" stroke="none" />
      <ellipse cx="32" cy="47.4" rx="13" ry="3.6" fill="#fff1c4" stroke={BROWN} strokeWidth="1" />
      <ellipse cx="32" cy="47.4" rx="8.4" ry="2" fill="#ffe08a" stroke="none" />
      <Figure
        x={31}
        y={47.4}
        scale={1.1}
        color={GOLD}
        arms={["M2.6-14.8 6.8-20", "M-2.6-14.8-6.6-12"]}
        legs={["M-1.3-8.4-2.4-.6", "M1.3-8.4 5-2.6"]}
      />
      <path d={star(44.4, 16.4, 3, 1.25)} fill={GOLD} stroke={BROWN} strokeWidth="0.8" />
      <Sparkle x={18.6} y={22} size={0.8} />
      <Sparkle x={47.6} y={30} size={0.6} />
    </>
  ),
  five: countMark("5", 21, [[32, 15.4, 2.6]]),
  ten: countMark("10", 17, [[28.4, 15.6, 2.3], [35.6, 15.6, 2.3]]),
  fifty: countMark("50", 17, [[25.6, 17.2, 2], [32, 14.8, 2.5], [38.4, 17.2, 2]]),
  hundred: (paint) => (
    <>
      {countMark("100", 13.5, [])(paint)}
      <Crown x={32} y={17.4} paint={paint} />
    </>
  ),
  "no-rest": (
    <>
      <g transform="translate(0 -3)" stroke={BROWN} strokeWidth="1.15">
        <path d="M32 48.6C24.6 48.6 19.6 43.6 19.6 37 19.6 31.4 23.4 28 25.4 24 26.6 26.6 28 27.8 29.4 28.2 28.6 22.6 31 17.4 35.6 13.6 35.4 18.4 37.4 21.4 40 24.4 42.8 27.6 44.4 31.2 44.4 36.4 44.4 43.4 39.4 48.6 32 48.6Z" fill="#ff6a1f" />
        <path d="M32 48.6C27.4 48.6 24.6 45.4 24.6 41.4 24.6 37.8 27 35.4 28.6 32.8 29.6 34.6 30.6 35.4 31.6 35.6 31.2 32 32.8 28.8 35.6 26.6 35.8 29.6 37.2 31.6 38.6 33.6 39.8 35.4 40.4 37.6 40.4 40.6 40.4 45.4 37 48.6 32 48.6Z" fill={GOLD} stroke="none" />
        <path d="M32 48.6C29.8 48.6 28.4 47 28.4 45 28.4 42.8 30 41.4 31 39.6 31.6 41 32.6 41.6 33.4 41.6 33.4 40.2 34 39 35 38.2 35.6 40.4 36 42.6 36 44.6 36 47 34.4 48.6 32 48.6Z" fill="#fff4c4" stroke="none" />
        <circle cx="29.6" cy="42.6" r="0.75" fill={BROWN} stroke="none" />
        <circle cx="34.4" cy="42.6" r="0.75" fill={BROWN} stroke="none" />
        <path d="M30.6 44.8q1.4 1.2 2.8 0" strokeWidth="0.8" fill="none" />
      </g>
      <circle cx="18.4" cy="20" r="1.1" fill={GOLD} stroke="none" />
      <circle cx="44.6" cy="15.6" r="0.9" fill={GOLD} stroke="none" />
      <circle cx="47.6" cy="24" r="0.7" fill="#fff4c4" stroke="none" />
      {Array.from({ length: 7 }, (_, index) => (
        <circle key={index} cx={21.8 + index * 3.4} cy="50.4" r="1.15" fill={GOLD} stroke={BROWN} strokeWidth="0.6" />
      ))}
    </>
  ),
  "busy-month": (
    <>
      <rect x="18" y="18" width="28" height="24" rx="2.2" fill="currentColor" fillOpacity="0.12" />
      <path d="M18 24.2h28" />
      <path d="M24 15.2v5M32 15.2v5M40 15.2v5" />
      <path d="m21.6 28.2 1.6 1.6 2.6-2.8M29.2 28.2l1.6 1.6 2.6-2.8M36.8 28.2l1.6 1.6 2.6-2.8" stroke="#ffd96a" />
      <path d="m21.6 34.2 1.6 1.6 2.6-2.8M29.2 34.2l1.6 1.6 2.6-2.8M36.8 34.2l1.6 1.6 2.6-2.8" stroke="#ffd96a" />
    </>
  ),
  "legendary-month": (paint) => (
    <>
      <path d="M20.5 22.4 24.2 27h4.2L32 19.6 35.6 27h4.2l3.7-4.6v2.2H20.5v-2.2Z" fill={paint.metal} stroke={paint.edge} strokeWidth="0.6" />
      <rect x="19.2" y="26.2" width="25.6" height="18" rx="2" fill="currentColor" fillOpacity="0.12" />
      <path d="M19.2 31.2h25.6" />
      <path d={star(32, 37.6, 3.6, 1.5)} fill={paint.metal} stroke={paint.edge} strokeWidth="0.5" />
    </>
  ),
  impossible: (
    <>
      <path d="M14 46.5 24.6 30.2l4.2 6.2L36.2 20.8 43 32.4l3.2-4.2L52 46.5Z" fill="#9aa6e8" fillOpacity="0.35" />
      <path d="M32.4 26.8 36.2 20.8l3.6 6.2-1.8-.8-1.8 1.4-1.8-1.4Z" fill={CREAM} />
      <path d="M14 46.5 24.6 30.2l4.2 6.2L36.2 20.8 43 32.4l3.2-4.2L52 46.5" />
      <path d="M28.8 46.5 33.4 38.6 37.6 46.5" />
      <path d="M36.2 20.8V14.6" />
      <path d="M36.2 14.8h5.2l-1.2 2.2h-4" fill="#ff5f6d" stroke="#ff5f6d" strokeWidth="0.8" />
      <path d={star(22.4, 20.6, 1.9, 0.8)} fill="#ffd96a" stroke="none" />
      <path d={star(46.8, 18.4, 1.7, 0.7)} fill="#ffd96a" stroke="none" />
    </>
  ),
  "two-a-day": (
    <>
      <rect x="16.5" y="20" width="18" height="22" rx="2" transform="rotate(-8 25.5 31)" fill="currentColor" fillOpacity="0.12" />
      <path d="M20.2 25.2h10M20.2 29h10M20.2 32.8h6" transform="rotate(-8 25.5 31)" />
      <rect x="29" y="20.5" width="18" height="22" rx="2" fill="currentColor" fillOpacity="0.2" />
      <path d="M33 26h10M33 29.8h10M33 33.6h6" />
      <path d="M34.2 20.5v-2.2a1.4 1.4 0 0 1 1.4-1.4h6.4a1.4 1.4 0 0 1 1.4 1.4v2.2" />
    </>
  ),
  weekend: (
    <g stroke={BROWN} strokeWidth="1.1">
      {Array.from({ length: 12 }, (_, index) => {
        const angle = index * 30;
        const [leftX, leftY] = point(angle - 9, 12);
        const [tipX, tipY] = point(angle, 17.2);
        const [rightX, rightY] = point(angle + 9, 12);
        return (
          <path
            key={index}
            d={`M${leftX.toFixed(2)} ${(leftY - 2).toFixed(2)}L${tipX.toFixed(2)} ${(tipY - 2).toFixed(2)}L${rightX.toFixed(2)} ${(rightY - 2).toFixed(2)}Z`}
            fill="#ffa62b"
          />
        );
      })}
      <circle cx="32" cy="30" r="11" fill="#ffd93d" />
      <path d="M24.4 23.6a9 9 0 0 1 6-3.6" stroke="#fff4c4" strokeWidth="1.3" fill="none" />
      <path d="M22.6 27.2h8.4v2.2c0 2.2-1.8 3.6-4.2 3.6s-4.2-1.4-4.2-3.6ZM33 27.2h8.4v2.2c0 2.2-1.8 3.6-4.2 3.6S33 31.6 33 29.4Z" fill="#2a2140" />
      <path d="M31 28h2" />
      <path d="M24.4 28.6l1.6-.2M34.8 28.6l1.6-.2" stroke="#8fd8ff" strokeWidth="0.9" />
      <path d="M27.6 35.4q4.4 3.6 8.8 0" fill="none" />
      <circle cx="23.4" cy="34" r="1.2" fill="#ff8f6b" fillOpacity="0.7" stroke="none" />
      <circle cx="40.6" cy="34" r="1.2" fill="#ff8f6b" fillOpacity="0.7" stroke="none" />
      <path d="M13.6 47.6a3.6 3.6 0 0 1 5.4-3.6 4.6 4.6 0 0 1 8.6 1.4 2.8 2.8 0 0 1-.2 5.6H15.2a2 2 0 0 1-1.6-3.4Z" fill="#fff" strokeWidth="1" />
    </g>
  ),
  monday: (
    <>
      <path d="M20 38.6a12 12 0 0 1 24 0" fill="#ffe58a" stroke="#ffe58a" />
      <path d="M16 38.6h32" />
      <path d="M32 22.4V16.8" />
      <path d="M24.6 25.2 21.2 21.8M39.4 25.2l3.4-3.4" />
      <path d="M27.4 19.2 26 16.6M36.6 19.2 38 16.6" />
      <path d="M16 43.4h32V60H16Z" fill="#7a2c14" fillOpacity="0.45" stroke="none" />
    </>
  ),
  early: (
    <>
      <circle cx="45" cy="48" r="9.5" fill="#fff6d2" stroke="none" />
      <path d="M31.6 46.6l-2.8-.9M33.8 40.6l-2.4-1.7M37.8 35.8l-1.6-2.4M43.4 33.6l-.4-2.9M49.4 34l.9-2.8M54.6 37.2l1.9-2.2" stroke="#fff6d2" strokeWidth="1.4" />
      <path d="M6 49.4c9-2.6 18-2.8 27-1.2 9 1.6 17 1.2 25-1.6V60H6Z" fill="#5daa52" stroke="none" />
      <path d="M6 49.4c9-2.6 18-2.8 27-1.2 9 1.6 17 1.2 25-1.6" stroke="#3a7a32" strokeWidth="0.9" />
      <g stroke={BROWN} strokeWidth="1.1">
        <path d="M29.6 44.2 28.4 49M34.4 44.6l.8 4.6M26.6 49.2h3.4M33.4 49.4h3.6" strokeWidth="1" />
        <path d="M20.6 22.6c.6-4 6-5.4 9-3 3.6 2.4 9.2 6.4 14.6 11.8l8.6 8.8-2.2 2.4-5.8-3c-3.6 4-9.2 5.8-14.4 5-5.6-1-9.6-6-9.8-11.6-.2-3.4.8-5.6 1.8-6.8Z" fill="#9a6538" />
        <path d="M21.6 26.4c-1.4 2.8-1.6 6.6-.2 10.2 2 4.8 6.4 7.4 11 7.8-1.6-4.4-3-10.4-4.2-14.8-1.4-2.2-3.8-3.2-6.6-3.2Z" fill="#ffd23f" stroke="none" />
        <path d="M21.2 30.2q3 4.4 5 4.8 1.2-2.6 2.2-5.4-1.2 1.6-2.4 2.6-2-.8-4.8-2Z" fill={BROWN} stroke="none" />
        <path d="M30.4 25.6c5.6 1.4 11.8 6.4 14.8 13-5.6.2-11.6-3-14.8-13Z" fill="#6a4122" />
        <path d="M34 29.4c2.2 1.4 4 3.2 5.4 5.4M33.4 32.6c1.8 1.4 3.4 2.6 5.4 3.4" stroke="#f3dcb0" strokeWidth="0.75" fill="none" />
        <path d="M20.6 22.6 12.6 20.2l8.4 4Z" fill="#e8a33a" />
        <path d="M21 24.2 13.8 27.4l8-1.2Z" fill="#e8a33a" />
        <path d="M21.4 20.4q3-1.8 6.6.2" stroke="#fff3d6" strokeWidth="0.9" fill="none" />
        <circle cx="24.8" cy="22.6" r="1.35" fill={BROWN} stroke="none" />
        <circle cx="25.2" cy="22.2" r="0.45" fill="#fff" stroke="none" />
      </g>
      <g fill={BROWN} stroke={BROWN} strokeWidth="0.9">
        <ellipse cx="17.6" cy="16.2" rx="1.5" ry="1.1" transform="rotate(-20 17.6 16.2)" stroke="none" />
        <path d="M19 15.8V10.6q2 .6 2.6 2.6" fill="none" />
        <ellipse cx="25.4" cy="12.8" rx="1.3" ry="0.95" transform="rotate(-20 25.4 12.8)" stroke="none" />
        <path d="M26.6 12.4V8.2" fill="none" />
      </g>
    </>
  ),
  late: (
    <>
      <path d="M49.4 13.6a6 6 0 1 0 4.4 9.6 4.6 4.6 0 1 1-4.4-9.6Z" fill="#fff1c4" stroke="none" />
      <path d={star(14.6, 23, 1.4, 0.55)} fill="#fff1c4" stroke="none" />
      <path d={star(19.8, 13.8, 1, 0.4)} fill="#fff1c4" stroke="none" />
      <path d={star(51.4, 34.2, 1.1, 0.45)} fill="#fff1c4" stroke="none" />
      <g transform="translate(-1.6 0)" stroke="#24160c" strokeWidth="1.15">
        <path d="M9 48.8h48" stroke="#6b4423" strokeWidth="2.6" />
        <path d="M21 16.4l3.8 4.2c2.4-.8 12-.8 14.4 0l3.8-4.2c1.6 4 2.4 8 2 12 1 7-.4 14-5.2 17.6-4.8 3.2-10.8 3.2-15.6 0-4.8-3.6-6.2-10.6-5.2-17.6-.4-4 .4-8 2-12Z" fill="#b5804f" />
        <path d="M19.2 31.2c-2.2 6-.8 11.8 3.8 15 .2-5.4-1-10.4-3.8-15ZM44.8 31.2c2.2 6 .8 11.8-3.8 15-.2-5.4 1-10.4 3.8-15Z" fill="#7a4d2c" />
        <ellipse cx="32" cy="40.4" rx="7.4" ry="6.4" fill="#f5dfb8" stroke="none" />
        <path d="M27.4 38.6q1.2 1.2 2.4 0M31 38.6q1.2 1.2 2.4 0M34.4 38.6q1.2 1.2 2.4 0M29.2 42q1.2 1.2 2.4 0M32.6 42q1.2 1.2 2.4 0" stroke="#a0714a" strokeWidth="0.8" fill="none" />
        <circle cx="27" cy="28.4" r="6" fill="#fff3d9" />
        <circle cx="37" cy="28.4" r="6" fill="#fff3d9" />
        <circle cx="27" cy="28.4" r="4" fill="#ffb627" strokeWidth="0.8" />
        <circle cx="37" cy="28.4" r="4" fill="#ffb627" strokeWidth="0.8" />
        <circle cx="27.4" cy="28.6" r="2.2" fill="#24160c" stroke="none" />
        <circle cx="36.6" cy="28.6" r="2.2" fill="#24160c" stroke="none" />
        <circle cx="28.2" cy="27.6" r="0.8" fill="#fff" stroke="none" />
        <circle cx="37.4" cy="27.6" r="0.8" fill="#fff" stroke="none" />
        <path d="M22 22.6q5-2.4 9.4 1.4M42 22.6q-5-2.4-9.4 1.4" fill="none" />
        <path d="M30.6 32.6h2.8L32 35.6Z" fill="#ff9a2e" strokeWidth="0.8" />
        <path d="M27.4 47.4v2.6M29.2 47.6v2.4M34.8 47.6v2.4M36.6 47.4v2.6" stroke="#ff9a2e" strokeWidth="1.1" />
      </g>
    </>
  ),
  "long-set": (
    <>
      <circle cx="32" cy="31" r="12" fill="currentColor" fillOpacity="0.14" />
      <circle cx="32" cy="31" r="9.4" />
      <path d="M32 21.2v1.8M32 39v1.8M22.2 31h1.8M40 31h1.8" />
      <path d="M25.2 24.2l1.2 1.2M38.8 37.8l1.2 1.2M38.8 24.2l-1.2 1.2M25.2 37.8l1.2-1.2" strokeWidth="1" />
      <path d="M32 25.4V31l4.2 2.6" stroke="#ffd96a" />
      <circle cx="32" cy="31" r="0.9" fill="currentColor" stroke="none" />
      <path d="M32 43.2v2.4M28.4 45.6h7.2" />
      <circle cx="32" cy="46.8" r="1.1" />
    </>
  ),
  "lone-wolf": (
    <>
      <circle cx="39" cy="23" r="14.5" fill="#fff1c4" fillOpacity="0.16" stroke="none" />
      <circle cx="39" cy="23" r="11.5" fill="#fff1c4" stroke="none" />
      <circle cx="47.4" cy="27" r="1.7" fill="#ecd796" stroke="none" />
      <circle cx="48.4" cy="22" r="1.1" fill="#ecd796" stroke="none" />
      <circle cx="34.2" cy="14.8" r="1.2" fill="#ecd796" stroke="none" />
      <path d={star(14.6, 25, 1.3, 0.5)} fill="#fff1c4" stroke="none" />
      <path d={star(19.4, 16.6, 0.9, 0.36)} fill="#fff1c4" stroke="none" />
      <path d={star(52.4, 40.2, 1, 0.4)} fill="#fff1c4" stroke="none" />
      <path d={star(17.6, 40.6, 0.8, 0.32)} fill="#fff1c4" stroke="none" />
      <path d="M4 54c9-3 18-4 28-3 9 1 17 .4 28-2V62H4Z" fill="#070b1c" stroke="none" />
      <path
        d="M42.7 12.7C41.4 13.2 40 14.6 38.5 16L36.1 18.2 34.6 19.2C33 20.6 31.6 21.8 30.6 23L28.8 25.2 26.2 28.3 22.6 31.3 27.5 32.1C26.4 33 25.6 34 25.3 34.9Q24 36.6 22.6 38.8Q24.4 38.6 25.4 39.2Q24 41 23.2 43Q25 42.6 26.4 43Q25.6 44.8 25.4 47Q27.4 46.4 29 47Q28.8 48.8 29.2 51Q31 50 32.6 50.4Q33 52.4 34.2 54.4L36.8 55.4Q37.6 53.4 38.4 52Q39.6 52.8 41.4 53.6Q40.6 51.4 40.8 49.4Q42.2 49.4 43.8 50Q42.6 47.8 42.8 46.4Q44.2 45.8 45.8 45.8Q44.2 44 43.6 42.2Q44.8 41.2 46 40.2Q44.4 38.8 44 36.6C44.2 33.6 43.6 31.4 42.9 29.6 42.2 27.6 41.8 26.2 42 25.2 42 24 42.2 23 42.5 22.1L43.8 19.9 46 18.2 41.6 20.1 43.6 15.1 43.1 13.4Z"
        fill="#10172f"
        stroke="#b9c6ff"
        strokeWidth="0.55"
      />
      <g stroke="#dfe6ff" strokeWidth="0.85" fill="none">
        <path d="M33.6 21.4q1.4-1.6 3.2-1.8" strokeWidth="1.1" />
        <path d="M34.2 19.8q1-1.2 2.6-1.8" strokeWidth="0.6" />
        <path d="M24.6 31.1q2-.7 3.8-.5" />
        <path d="M34 24.6c.4 1.2 1 2.2 1.6 2.9" />
        <path d="M30.2 28.6c1.4 1.6 2.6 2.2 4 2.4 1.4.2 2.6 1 3.4 2.2.6-1 1.2-1.6 1.8-2.2" strokeWidth="1.05" />
        <path d="M39.6 23.6c.6 2.2.6 4.4 0 6.4" />
        <path d="M27.2 34.2c.8 1.4 1.2 2.8 1.2 4.4" />
        <path d="M30.8 37.2c2 .6 4 2 5 4-.4.8-1 1.2-1.8 1.4" strokeWidth="1.05" />
        <path d="M39.4 37.6c.9 1.6 1.3 3.4 1.2 5.2" />
      </g>
    </>
  ),
  "solo-fine": (
    <>
      <ellipse cx="32" cy="45.6" rx="14" ry="3.4" fill="none" stroke="#fff0f7" strokeOpacity="0.55" strokeWidth="1" />
      <ellipse cx="32" cy="46.6" rx="9" ry="2" fill="#ffd6ea" fillOpacity="0.55" stroke="none" />
      <Figure
        x={32}
        y={47}
        scale={1.1}
        color="#8fe3ff"
        headphones
        arms={["M2.6-14.8 6-21.6", "M-2.6-14.8-6-21.6"]}
        legs={["M-1.3-8.4-2.6-.6", "M1.3-8.4 2.8-.6"]}
      />
      <path d="M17.6 33.4q-2.4-4.4 0-8.8M46.4 33.4q2.4-4.4 0-8.8" stroke="#fff0f7" strokeWidth="1" fill="none" />
      <g fill={GOLD} stroke={BROWN} strokeWidth="0.7">
        <ellipse cx="16.4" cy="21.4" rx="1.7" ry="1.25" transform="rotate(-20 16.4 21.4)" />
        <path d="M17.9 21V15.2q2.2.6 2.8 2.8" fill="none" strokeWidth="0.9" />
        <ellipse cx="45.6" cy="17.6" rx="1.5" ry="1.1" transform="rotate(-20 45.6 17.6)" />
        <path d="M46.9 17.2V12.4" fill="none" strokeWidth="0.9" />
      </g>
    </>
  ),
  "first-pair": (
    <>
      <ellipse cx="32" cy="47.6" rx="15" ry="3.2" fill="#fff0f3" fillOpacity="0.35" stroke="none" />
      <Dancer
        x={25}
        y={47.6}
        outfit="#4d8dff"
        hair="#3a2716"
        arms={["M3.4-15 7-23.4", "M-3.4-15-6.4-10.4"]}
        legs={["M-1.4-8.4-2.4-.6", "M1.4-8.4 2.6-.6"]}
      />
      <Dancer
        x={39}
        y={47.6}
        flip
        follow
        outfit={RED}
        hair="#e0a526"
        arms={["M2.8-15 7-23.4", "M-2.8-15-6.6-12"]}
        legs={["M-1.2-5-1.6-.4", "M1.2-5 2.2-.4"]}
      />
      <path d={HEART} transform="translate(32 15.4) scale(1.05)" fill={RED} stroke={BROWN} strokeWidth="1" />
      <Sparkle x={18} y={18.6} size={0.7} />
      <Sparkle x={46.4} y={19.6} size={0.6} />
    </>
  ),
  circle: (
    <>
      <circle cx="32" cy="32" r="12.6" stroke="#fff1c4" strokeOpacity="0.7" strokeWidth="1.4" strokeDasharray="0.1 2.6" />
      <circle cx="32" cy="32" r="5.6" fill="#fff1c4" fillOpacity="0.3" stroke="none" />
      <path d={HEART} transform="translate(32 32.4) scale(0.95)" fill={RED} stroke={BROWN} strokeWidth="1.1" />
      <Ring count={5} radius={12.8} scale={1} />
    </>
  ),
  "wide-circle": (paint) => (
    <>
      <circle cx="32" cy="32" r="15.8" stroke="#fff1c4" strokeOpacity="0.6" strokeWidth="1.2" strokeDasharray="0.1 2.4" />
      <circle cx="32" cy="32" r="9.4" fill="#fff1c4" fillOpacity="0.28" stroke="none" />
      <path d={star(32, 32.6, 7.4, 3.2)} fill={paint.metal} stroke={paint.edge} strokeWidth="0.8" />
      <Ring count={10} radius={15.8} scale={0.72} />
    </>
  ),
  loyal: (
    <g stroke={BROWN} strokeWidth="1.15">
      <path d="M25.4 29.4V23.4a6.6 6.6 0 0 1 13.2 0v6" strokeWidth="4.4" fill="none" />
      <path d="M25.4 29.4V23.4a6.6 6.6 0 0 1 13.2 0v6" stroke="#e4e8ef" strokeWidth="2.2" fill="none" />
      <rect x="20.6" y="28.2" width="22.8" height="18" rx="3.6" fill="#f2b739" />
      <path d="M23 30.8h18" stroke="#ffe08a" strokeWidth="1.2" />
      <path d={HEART} transform="translate(32 37.4) scale(1.3)" fill={RED} strokeWidth="0.85" />
      <path d="M30.2 35.2a1.2 1.2 0 0 1 1.6-.8" stroke="#ffd0da" strokeWidth="0.8" fill="none" />
      <Sparkle x={17.2} y={24} size={0.9} />
      <Sparkle x={47.2} y={22} size={0.7} />
      <Sparkle x={46.4} y={44} size={0.6} />
    </g>
  ),
  inseparable: (
    <g stroke={BROWN} strokeWidth="1.1">
      <ellipse cx="32" cy="48.4" rx="13" ry="2.4" fill="#5a0c26" fillOpacity="0.35" stroke="none" />
      <path d="M0-12C3.2-7.6 7-3.4 7 1.4A7 7 0 0 1-7 1.4C-7-3.4-3.2-7.6 0-12Z" transform="translate(25.6 39) rotate(-12)" fill="#8fdcff" />
      <path d="M0-12C3.2-7.6 7-3.4 7 1.4A7 7 0 0 1-7 1.4C-7-3.4-3.2-7.6 0-12Z" transform="translate(38.4 39) rotate(12)" fill="#5cc4ff" />
      <path d="M21.4 33.4q-1.2 2.2-.6 4.4M42.6 33.4q1.2 2.2.6 4.4" stroke="#fff" strokeWidth="1" fill="none" />
      <path d="M23.2 39.2q1.2-1.2 2.4 0M26.8 39.2q1.2-1.2 2.4 0M34.8 39.2q1.2-1.2 2.4 0M38.4 39.2q1.2-1.2 2.4 0" strokeWidth="0.85" fill="none" />
      <path d="M25.4 42q.9.7 1.8 0M37 42q.9.7 1.8 0" strokeWidth="0.75" fill="none" />
      <circle cx="22.6" cy="41.4" r="0.9" fill="#ff8fab" stroke="none" />
      <circle cx="41.4" cy="41.4" r="0.9" fill="#ff8fab" stroke="none" />
      <Limb d="M29.6 43.6q2.8.8 5.2-1.2" color="#8fdcff" />
      <Limb d="M34.4 44.4q-2.6.4-4.6-1.4" color="#5cc4ff" />
      <path d={HEART} transform="translate(32 18.4) scale(0.9)" fill={RED} strokeWidth="1" />
      <Sparkle x={20.4} y={18.8} size={0.6} />
      <Sparkle x={44} y={20.6} size={0.7} />
    </g>
  ),
  "three-weeks": (
    <g stroke={BROWN} strokeWidth="1.1">
      <ellipse cx="32" cy="36" rx="17" ry="9" fill="#fff1c4" fillOpacity="0.18" stroke="none" />
      {[20.2, 32, 43.8].map((x, index) => (
        <g key={x} transform={`translate(${x} ${index === 1 ? 35 : 37}) scale(${index === 1 ? 1.3 : 1.12})`}>
          <path d="M-4.6-1.6-2.6-4.4H2.6L4.6-1.6 0 4.8Z" fill={RED} />
          <path d="M-4.6-1.6-2.6-4.4H2.6L4.6-1.6Z" fill="#ff9aae" strokeWidth="0.8" />
          <path d="M-1.4-4.4-1.8-1.6 0 4.8 1.8-1.6 1.4-4.4M-1.8-1.6H1.8" strokeWidth="0.6" fill="none" />
        </g>
      ))}
      <rect x="15" y="44.2" width="34" height="3.4" rx="1.7" fill={GOLD} />
      <Sparkle x={21.4} y={25} size={0.8} />
      <Sparkle x={43} y={24} size={0.9} />
      <Sparkle x={32} y={20} size={0.7} />
    </g>
  ),
  "two-months": (
    <>
      <Calendar x={26.4} y={30.6} angle={-12} header="#ffa62b">
        <path d="M-5.6-.6h2.4M-1.2-.6h2.4M3.2-.6h2.4M-5.6 3.4h2.4M-1.2 3.4h2.4M3.2 3.4h2.4M-5.6 7.2h2.4" stroke="#c9b9a0" strokeWidth="1.3" />
      </Calendar>
      <Calendar x={37.4} y={34.6} angle={8} header={RED}>
        <path d="M-4.6 2.4-1.2 5.6 5-.8" strokeWidth="3.8" fill="none" />
        <path d="M-4.6 2.4-1.2 5.6 5-.8" stroke="#2fbf71" strokeWidth="2.2" fill="none" />
      </Calendar>
      <Sparkle x={46.4} y={18.4} size={0.9} />
      <Sparkle x={16.4} y={44.6} size={0.6} />
    </>
  ),
  "dance-master": (paint) => (
    <>
      <path d="M19.2 23.4 23.6 29.2h4.4L32 16.6l4 12.6h4.4l4.4-5.8-1.6 5.8H20.8Z" fill={paint.metal} stroke={paint.edge} strokeWidth="0.6" />
      <path d={star(32, 37.6, 7.8, 3.2)} fill={paint.metal} stroke={paint.edge} strokeWidth="0.6" />
      <path d="M23.6 46.2h16.8l-2 3.6H25.6l-2-3.6Z" fill={paint.metal} stroke={paint.edge} strokeWidth="0.6" />
    </>
  ),
  sloth: (paint) => <Sloth paint={paint} />,
  "grand-sloth": (paint) => <Sloth grand paint={paint} />,
  "cunning-carburetor": <Capybara />,
};

export function AchievementIcon({ name, size = 108 }) {
  const id = useId().replace(/:/g, "");
  const look = LOOKS[name] ?? LOOKS["first-step"];
  const metal = METALS[look.metal];
  const scene = SCENES[name] ?? SCENES["first-step"];
  const [cx, cy] = look.center ?? [42, 32];
  const paint = { metal: `url(#${id}-metal)`, edge: metal.dark };
  const metalStops = [
    [0, metal.light],
    [0.42, metal.mid],
    [0.72, metal.dark],
    [1, metal.mid],
  ];

  return (
    <svg viewBox="0 0 64 64" width={size} height={size} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="1" y2="1">
          {metalStops.map(([offset, color]) => <stop key={offset} offset={offset} stopColor={color} />)}
        </linearGradient>
        <linearGradient id={`${id}-bevel`} x1="1" y1="1" x2="0" y2="0">
          {metalStops.map(([offset, color]) => <stop key={offset} offset={offset} stopColor={color} />)}
        </linearGradient>
        <radialGradient id={`${id}-field`} cx={`${cx}%`} cy={`${cy}%`} r="78%">
          {look.field.map((color, index) => (
            <stop key={color} offset={index / (look.field.length - 1)} stopColor={color} />
          ))}
        </radialGradient>
        <linearGradient id={`${id}-gloss`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.42" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <circle cx="32" cy="32" r="23.6" />
        </clipPath>
      </defs>
      <circle cx="32" cy="32" r="30.2" fill={`url(#${id}-metal)`} stroke={metal.dark} strokeWidth="0.6" />
      <circle cx="32" cy="32" r="29.1" stroke={metal.light} strokeWidth="0.5" strokeOpacity="0.75" />
      {beads(metal.dark)}
      <circle cx="32" cy="32" r="25.4" fill={`url(#${id}-bevel)`} />
      <circle cx="32" cy="32" r="23.6" fill={`url(#${id}-field)`} />
      <g clipPath={`url(#${id}-clip)`} color={CREAM} stroke="currentColor" strokeWidth="1.6">
        {typeof scene === "function" ? scene(paint) : scene}
      </g>
      <circle cx="32" cy="32" r="23.6" stroke="#000" strokeOpacity="0.3" strokeWidth="1" />
      <path d="M12.6 25.4C15.4 16.4 23 10.6 32 10.6c6.4 0 12.2 3 16 7.6-5-2.4-10.4-3.4-16-3.2-8.4.4-15 4.2-19.4 10.4Z" fill={`url(#${id}-gloss)`} />
    </svg>
  );
}
