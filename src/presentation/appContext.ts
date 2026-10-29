import { ref } from 'vue';
import { serializeCapabilities, type CapabilityKey } from '../../shared/authorizationCapabilities';
import type { CurrentMembership } from '../services/householdClient';
export const activeCapabilities = ref<CapabilityKey[]>([]);
export function applyMembershipContext(membership: CurrentMembership | null): void {
  activeCapabilities.value = serializeCapabilities(membership?.capabilities ?? []);
}
