import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = 'cardiotwin.mobile.settings.v1'

export type Settings = {
  apiBase: string
  patientId: string
  onboardingComplete: boolean
  lastSyncAt?: string
  lastSyncDay?: string
}

export const DEFAULT_SETTINGS: Settings = {
  apiBase: 'http://192.168.1.10:8000',
  patientId: 'HF-0004',
  onboardingComplete: false,
}

export async function loadSettings(): Promise<Settings> {
  const raw = await AsyncStorage.getItem(KEY)
  if (!raw) return DEFAULT_SETTINGS
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export async function saveSettings(value: Settings) {
  await AsyncStorage.setItem(KEY, JSON.stringify(value))
}
