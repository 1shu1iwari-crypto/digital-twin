import { Linking } from 'react-native'
import {
  CategoryValueSleepAnalysis,
  isHealthDataAvailableAsync,
  queryCategorySamples,
  queryQuantitySamples,
  queryStatisticsForQuantity,
  requestAuthorization,
} from '@kingstinct/react-native-healthkit'
import type { DailyReading, HealthAdapter } from './contracts'
import { clampIntervalsToMinutes, localDayRange, round } from './utils'

const READ_TYPES = [
  'HKQuantityTypeIdentifierRestingHeartRate',
  'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
  'HKQuantityTypeIdentifierRespiratoryRate',
  'HKQuantityTypeIdentifierOxygenSaturation',
  'HKQuantityTypeIdentifierStepCount',
  'HKQuantityTypeIdentifierBodyMass',
  'HKQuantityTypeIdentifierBloodPressureSystolic',
  'HKQuantityTypeIdentifierBloodPressureDiastolic',
  'HKCategoryTypeIdentifierSleepAnalysis',
] as const

const filter = (start: Date, end: Date) => ({
  date: { startDate: start, endDate: end },
})

async function average(
  identifier:
    | 'HKQuantityTypeIdentifierRestingHeartRate'
    | 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN'
    | 'HKQuantityTypeIdentifierRespiratoryRate'
    | 'HKQuantityTypeIdentifierOxygenSaturation',
  unit: 'count/min' | 'ms' | '%',
  start: Date,
  end: Date,
) {
  try {
    const result = await queryStatisticsForQuantity(
      identifier,
      ['discreteAverage'],
      { filter: filter(start, end), unit },
    )
    return result.averageQuantity?.quantity
  } catch {
    return undefined
  }
}

async function latest(
  identifier:
    | 'HKQuantityTypeIdentifierBodyMass'
    | 'HKQuantityTypeIdentifierBloodPressureSystolic'
    | 'HKQuantityTypeIdentifierBloodPressureDiastolic',
  unit: 'kg' | 'mmHg',
  start: Date,
  end: Date,
) {
  try {
    const result = await queryQuantitySamples(identifier, {
      limit: 1,
      unit,
      filter: filter(start, end),
    })
    return result[0]?.quantity
  } catch {
    return undefined
  }
}

const adapter: HealthAdapter = {
  source: 'apple_health',
  displayName: 'Apple Health',
  hrvLabel: 'HRV · SDNN',

  async checkAvailability() {
    const available = await isHealthDataAvailableAsync()
    return available
      ? {
          available: true,
          label: 'Apple Health is available',
          detail: 'Your iPhone controls access. CardioTwin only reads categories you approve.',
          action: 'settings',
        }
      : {
          available: false,
          label: 'Apple Health is unavailable',
          detail: 'HealthKit is not available on this device.',
        }
  },

  async requestPermissions() {
    await requestAuthorization({ toRead: [...READ_TYPES] })
    return {
      requested: true,
      detail:
        'HealthKit completed the authorization request. Apple does not reveal which read categories were denied; denied categories simply return no data.',
    }
  },

  async readDailySummary(day: string) {
    const { start, end } = localDayRange(day)
    const readings: DailyReading[] = []

    const [
      restingHr,
      hrv,
      respiratoryRate,
      oxygenFraction,
      weight,
      systolic,
      diastolic,
    ] = await Promise.all([
      average('HKQuantityTypeIdentifierRestingHeartRate', 'count/min', start, end),
      average('HKQuantityTypeIdentifierHeartRateVariabilitySDNN', 'ms', start, end),
      average('HKQuantityTypeIdentifierRespiratoryRate', 'count/min', start, end),
      average('HKQuantityTypeIdentifierOxygenSaturation', '%', start, end),
      latest('HKQuantityTypeIdentifierBodyMass', 'kg', start, end),
      latest('HKQuantityTypeIdentifierBloodPressureSystolic', 'mmHg', start, end),
      latest('HKQuantityTypeIdentifierBloodPressureDiastolic', 'mmHg', start, end),
    ])

    try {
      const steps = await queryStatisticsForQuantity(
        'HKQuantityTypeIdentifierStepCount',
        ['cumulativeSum'],
        { filter: filter(start, end), unit: 'count' },
      )
      if (steps.sumQuantity?.quantity != null) {
        readings.push({
          metric: 'steps',
          value: Math.round(steps.sumQuantity.quantity),
          unit: 'steps',
          sourceMetric: 'HealthKit StepCount',
        })
      }
    } catch {}

    try {
      const sleep = await queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis', {
        limit: 0,
        filter: filter(start, end),
      })
      const asleep = new Set<number>([
        CategoryValueSleepAnalysis.asleepUnspecified,
        CategoryValueSleepAnalysis.asleepCore,
        CategoryValueSleepAnalysis.asleepDeep,
        CategoryValueSleepAnalysis.asleepREM,
      ])
      const minutes = clampIntervalsToMinutes(
        sleep
          .filter(sample => asleep.has(sample.value))
          .map(sample => ({ start: sample.startDate, end: sample.endDate })),
        start,
        end,
      )
      if (minutes > 0) {
        readings.push({
          metric: 'sleep_minutes',
          value: round(minutes, 0),
          unit: 'min',
          sourceMetric: 'HealthKit SleepAnalysis',
        })
      }
    } catch {}

    if (restingHr != null) readings.push({ metric: 'heart_rate', value: round(restingHr), unit: 'bpm', sourceMetric: 'HealthKit RestingHeartRate' })
    if (hrv != null) readings.push({ metric: 'heart_rate_variability', value: round(hrv), unit: 'ms', sourceMetric: 'HealthKit HRV SDNN' })
    if (respiratoryRate != null) readings.push({ metric: 'respiratory_rate', value: round(respiratoryRate), unit: '/min', sourceMetric: 'HealthKit RespiratoryRate' })
    if (oxygenFraction != null) readings.push({ metric: 'oxygen_saturation', value: round(oxygenFraction * 100), unit: '%', sourceMetric: 'HealthKit OxygenSaturation' })
    if (weight != null) readings.push({ metric: 'body_weight', value: round(weight), unit: 'kg', sourceMetric: 'HealthKit BodyMass' })
    if (systolic != null) readings.push({ metric: 'systolic_bp', value: round(systolic, 0), unit: 'mmHg', sourceMetric: 'HealthKit BloodPressureSystolic' })
    if (diastolic != null) readings.push({ metric: 'diastolic_bp', value: round(diastolic, 0), unit: 'mmHg', sourceMetric: 'HealthKit BloodPressureDiastolic' })

    if (!readings.length) {
      throw new Error('No authorized Apple Health readings were found for this day.')
    }
    return { source: 'apple_health', timestamp: day, readings }
  },

  async openSettings() {
    await Linking.openSettings()
  },
}

export default adapter
