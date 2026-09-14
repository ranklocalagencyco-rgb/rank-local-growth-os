import { getRuntimeConfig } from "@/config/env";

export default function HomePage() {
  const config = getRuntimeConfig();

  return (
    <main>
      <h1>Rank Local Growth OS</h1>
      <p>Foundation online. Send mode: {config.sendMode}.</p>
    </main>
  );
}
