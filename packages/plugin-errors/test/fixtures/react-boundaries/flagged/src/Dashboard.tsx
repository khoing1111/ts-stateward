import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { PanelBoundary } from "./PanelBoundary";
import { useStats } from "./stats";

function drawChart(points: number): void {
  if (points < 0) throw new RangeError("a chart needs at least one point");
}

function Chart({ points }: { points: number }) {
  useEffect(() => {
    drawChart(points);
  }, [points]);
  return <canvas />;
}

function Stats() {
  const stats = useStats(localStorage.getItem("stats") ?? "{}");
  return <p>{stats.visits} visits</p>;
}

export function Dashboard() {
  const { range = "week" } = useParams();
  return (
    <section>
      <h1>This {range}</h1>
      <PanelBoundary>
        <Chart points={7} />
      </PanelBoundary>
      <Stats />
    </section>
  );
}
