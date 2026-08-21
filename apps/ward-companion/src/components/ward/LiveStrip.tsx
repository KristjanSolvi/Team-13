import type { Patient } from "@/data/ward";
import { CortiLiveStrip } from "./CortiLiveStrip";

type Props = {
  patient: Patient;
  onAuthoritativeChange: () => Promise<void>;
};

/**
 * The ward-round panel is intentionally live-only. Clinical transcript content
 * must come from the active Corti Ambient interaction, never a timed fixture.
 */
export function LiveStrip({ patient, onAuthoritativeChange }: Props) {
  return <CortiLiveStrip patient={patient} onAuthoritativeChange={onAuthoritativeChange} />;
}
