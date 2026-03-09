import { getAppConfig } from "@/lib/config";
import WorkstationClient from "@/components/WorkstationClient";

export default function Page() {
  const cfg = getAppConfig();
  return <WorkstationClient config={cfg} />;
}
