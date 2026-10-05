import { Linking } from 'react-native'
import {
  SdkAvailabilityStatus,
  SleepStageType,
  aggregateRecord,
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  openHealthConnectSettings,
  readRecords,
  requestPermission,
} from 'react-native-health-connect'
import type { DailyReading, HealthAdapter } from './contracts'
import { clampIntervalsToMinutes, localDayRange, mean, round } from './utils'

const PERMISSIONS = [
  { accessType: 'read', recordType: 'HeartRate' },
  { accessType: 'read', recordType: 'RestingHeartRate' },
  { accessType: 'read', recordType: 'HeartRateVariabilityRmssd' },
  { accessType: 'read', recordType: 'RespiratoryRate' },
  { accessType: 'read', recordType: 'OxygenSaturation' },
  { accessType: 'read', recordType: 'Steps' },
  { accessType: 'read', recordType: 'Weight' },
  { accessType: 'read', recordType: 'BloodPressure' },
  { accessType: 'read', recordType: 'SleepSession' },
] as const

function range(start: Date, end: Date) {
  return {
    timeRangeFilter: {
      operator: 'between' as const,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    },
  }
}

async function safely<T>(work: () => Promise<T>): Promise<T | undefined> {
  try {
    return await work()
  } catch {
    return undefined
  }
}

const adapter: HealthAdapter = {
  source: 'health_connect',
  displayName: 'Health Connect',
  hrvLabel: 'HRV · RMSSD',

  async checkAvailability() {
    const status = await getSdkStatus()
    if (status === SdkAvailabilityStatus.SDK_AVAILABLE) {
      const initialized = await initialize()
      return initialized
        ? {
            available: true,
            label: 'Health Connect is ready',
            detail: 'CardioTwin can read records from apps you have allowed to share with Health Connect.',
            action: 'settings',
          }
        : {
            available: false,
            label: 'Health Connect could not initialize',
            detail: 'Open Health Connect, finish setup, then return to CardioTwin.',
            action: 'settings',
          }
    }
    if (status === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) {
      return {
        available: false,
        label: 'Health Connect needs an update',
        detail: 'Update the Health Connect provider, then try again.',
        action: 'install',
      }
    }
    return {
      available: false,
      label: 'Health Connect is unavailable',
      detail: 'Android 14+ includes it in the system. Android 8–13 requires the Health Connect provider app.',
      action: 'install',
    }
  },

  async requestPermissions() {
    await initialize()
    await requestPermission([...PERMISSIONS])
    const after = await getGrantedPermissions()
    const count = after.filter(permission => permission.accessType === 'read').length
    return {
      requested: count > 0,
      detail: `${count} read permission${count === 1 ? '' : 's'} currently available to CardioTwin.`,
    }
  },

  async readDailySummary(day: string) {
    await initialize()
    const { start, end } = localDayRange(day)
    const timeRange = range(start, end)
    const readings: DailyReading[] = []

    const [
      steps,
      resting,
      fallbackHeartRate,
      hrv,
      resp,
      oxygen,
      weight,
      pressure,
      sleep,
    ] = await Promise.all([
      safely(() => aggregateRecord({ recordType: 'Steps', ...timeRange })),
      safely(() => aggregateRecord({ recordType: 'RestingHeartRate', ...timeRange })),
      safely(() => aggregateRecord({ recordType: 'HeartRate', ...timeRange })),
      safely(() => readRecords('HeartRateVariabilityRmssd', timeRange)),
      safely(() => readRecords('RespiratoryRate', timeRange)),
      safely(() => readRecords('OxygenSaturation', timeRange)),
      safely(() => readRecords('Weight', timeRange)),
      safely(() => readRecords('BloodPressure', timeRange)),
      safely(() => readRecords('SleepSession', timeRange)),
    ])

    if (steps?.COUNT_TOTAL != null) {
      readings.push({ metric: 'steps', value: Math.round(steps.COUNT_TOTAL), unit: 'steps', sourceMetric: 'Health Connect Steps' })
    }

    const bpm = resting?.BPM_AVG ?? fallbackHeartRate?.BPM_AVG
    if (bpm != null) {
      readings.push({
        metric: 'heart_rate',
        value: round(bpm),
        unit: 'bpm',
        sourceMetric: resting?.BPM_AVG != null ? 'Health Connect RestingHeartRate' : 'Health Connect HeartRate daily average',
      })
    }

    const hrvValue = mean(hrv?.records.map(record => record.heartRateVariabilityMillis) ?? [])
    if (hrvValue != null) readings.push({ metric: 'heart_rate_variability', value: round(hrvValue), unit: 'ms', sourceMetric: 'Health Connect HRV RMSSD' })

    const respiratory = mean(resp?.records.map(record => record.rate) ?? [])
    if (respiratory != null) readings.push({ metric: 'respiratory_rate', value: round(respiratory), unit: '/min', sourceMetric: 'Health Connect RespiratoryRate' })

    const spo2 = mean(oxygen?.records.map(record => record.percentage) ?? [])
    if (spo2 != null) readings.push({ metric: 'oxygen_saturation', value: round(spo2), unit: '%', sourceMetric: 'Health Connect OxygenSaturation' })

    const latestWeight = weight?.records.slice().sort((a, b) => b.time.localeCompare(a.time))[0]
    if (latestWeight) readings.push({ metric: 'body_weight', value: round(latestWeight.weight.inKilograms), unit: 'kg', sourceMetric: 'Health Connect Weight' })

    const latestPressure = pressure?.records.slice().sort((a, b) => b.time.localeCompare(a.time))[0]
    if (latestPressure) {
      readings.push({ metric: 'systolic_bp', value: round(latestPressure.systolic.inMillimetersOfMercury, 0), unit: 'mmHg', sourceMetric: 'Health Connect BloodPressure' })
      readings.push({ metric: 'diastolic_bp', value: round(latestPressure.diastolic.inMillimetersOfMercury, 0), unit: 'mmHg', sourceMetric: 'Health Connect BloodPressure' })
    }

    if (sleep?.records.length) {
      const intervals: Array<{start: Date; end: Date}> = []
      for (const session of sleep.records) {
        const sleepingStages = session.stages?.filter(stage =>
          [SleepStageType.SLEEPING, SleepStageType.LIGHT, SleepStageType.DEEP, SleepStageType.REM].includes(stage.stage as 2 | 4 | 5 | 6),
        )
        if (sleepingStages?.length) {
          intervals.push(...sleepingStages.map(stage => ({
            start: new Date(stage.startTime),
            end: new Date(stage.endTime),
          })))
        } else {
          intervals.push({ start: new Date(session.startTime), end: new Date(session.endTime) })
        }
      }
      const minutes = clampIntervalsToMinutes(intervals, start, end)
      if (minutes > 0) readings.push({ metric: 'sleep_minutes', value: round(minutes, 0), unit: 'min', sourceMetric: 'Health Connect SleepSession' })
    }

    if (!readings.length) {
      throw new Error('No permitted Health Connect readings were found for this day.')
    }
    return { source: 'health_connect', timestamp: day, readings }
  },

  async openSettings() {
    try {
      openHealthConnectSettings()
    } catch {
      await Linking.openSettings()
    }
  },
}

export default adapter
