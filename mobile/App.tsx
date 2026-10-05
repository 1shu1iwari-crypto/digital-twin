import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { getPatient, nextCalendarDay, uploadSummary, type TwinResponse } from './src/api'
import nativeHealth from './src/health/nativeHealth'
import type { DailySummary, HealthAvailability } from './src/health/contracts'
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './src/storage'

type Tab = 'today' | 'connect' | 'settings'

const COLORS = {
  paper: '#F6F3EA',
  card: '#FFFDF8',
  ink: '#252A27',
  muted: '#6F746F',
  green: '#25594F',
  greenSoft: '#DDE9E3',
  clay: '#A95F4B',
  claySoft: '#F1E1D9',
  line: '#DCD8CD',
}

function risk(value: number | null | undefined) {
  return value == null ? '—' : `${Math.round(value * 100)}%`
}

function Button({
  title,
  onPress,
  secondary = false,
  disabled = false,
}: {
  title: string
  onPress: () => void
  secondary?: boolean
  disabled?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({pressed}) => [
        styles.button,
        secondary ? styles.buttonSecondary : styles.buttonPrimary,
        disabled && styles.disabled,
        pressed && !disabled && {opacity: 0.8},
      ]}
    >
      <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{title}</Text>
    </Pressable>
  )
}

function Brand() {
  return (
    <View style={styles.brandRow}>
      <View style={styles.brandMark}><Text style={styles.brandMarkText}>CT</Text></View>
      <Text style={styles.brandText}>cardiotwin</Text>
    </View>
  )
}

function Onboarding({
  settings,
  onComplete,
}: {
  settings: Settings
  onComplete: (settings: Settings) => Promise<void>
}) {
  const [step, setStep] = useState(0)
  const [apiBase, setApiBase] = useState(settings.apiBase)
  const [patientId, setPatientId] = useState(settings.patientId)

  const pages = [
    {
      eyebrow: 'YOUR LIVING TWIN',
      title: 'Health data should feel useful, not overwhelming.',
      body: 'CardioTwin turns a small daily set of wearable signals into a patient-specific timeline. The model remains a research prototype, not a diagnosis or treatment system.',
    },
    {
      eyebrow: 'PRIVACY BY DESIGN',
      title: 'Your phone stays in control.',
      body: `You approve access in ${Platform.OS === 'ios' ? 'Apple Health' : 'Health Connect'}. CardioTwin reads one day, builds a small summary in memory, and lets you review it before anything is uploaded.`,
    },
    {
      eyebrow: 'CONNECT YOUR WORKSPACE',
      title: 'Link this phone to CardioTwin.',
      body: 'For local testing, keep phone and computer on the same Wi-Fi and use the computer LAN address rather than localhost.',
    },
  ] as const
  const page = pages[step]!

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.onboarding}>
        <Brand />
        <View style={styles.heroVisual}>
          <View style={styles.heroOuter}>
            <View style={styles.heroInner}>
              <Text style={styles.heart}>♥</Text>
            </View>
          </View>
          <View style={[styles.sensorBubble, {top: 24, left: 6}]}><Text style={styles.sensorBubbleText}>HR</Text></View>
          <View style={[styles.sensorBubble, {right: 0, top: 84}]}><Text style={styles.sensorBubbleText}>SpO₂</Text></View>
          <View style={[styles.sensorBubble, {bottom: 20, left: 18}]}><Text style={styles.sensorBubbleText}>Sleep</Text></View>
        </View>

        <Text style={styles.eyebrow}>{page.eyebrow}</Text>
        <Text style={styles.heroTitle}>{page.title}</Text>
        <Text style={styles.body}>{page.body}</Text>

        {step === 2 && (
          <View style={styles.formCard}>
            <Text style={styles.label}>CardioTwin API</Text>
            <TextInput
              value={apiBase}
              onChangeText={setApiBase}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="http://192.168.1.23:8000"
              placeholderTextColor="#9A9C96"
              style={styles.input}
            />
            <Text style={styles.label}>Patient ID</Text>
            <TextInput
              value={patientId}
              onChangeText={setPatientId}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="HF-0004"
              placeholderTextColor="#9A9C96"
              style={styles.input}
            />
          </View>
        )}

        <View style={styles.dots}>
          {pages.map((_, index) => <View key={index} style={[styles.dot, index === step && styles.dotActive]} />)}
        </View>

        <Button
          title={step === pages.length - 1 ? 'Enter CardioTwin' : 'Continue'}
          onPress={() => {
            if (step < pages.length - 1) setStep(value => value + 1)
            else void onComplete({
              ...settings,
              apiBase: apiBase.trim(),
              patientId: patientId.trim(),
              onboardingComplete: true,
            })
          }}
        />
        {step > 0 && <Button title="Back" secondary onPress={() => setStep(value => value - 1)} />}
      </ScrollView>
    </SafeAreaView>
  )
}

function Today({
  patient,
  settings,
  loading,
  refresh,
  openConnect,
}: {
  patient: TwinResponse | null
  settings: Settings
  loading: boolean
  refresh: () => void
  openConnect: () => void
}) {
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.eyebrow}>TODAY / {settings.patientId}</Text>
      <Text style={styles.pageTitle}>Your twin, in one glance.</Text>
      <Text style={styles.body}>A daily view of what changed against your personal baseline.</Text>

      <View style={styles.riskCard}>
        <View>
          <Text style={styles.kicker}>ESTIMATED 7-DAY RISK</Text>
          {loading
            ? <ActivityIndicator style={{marginTop: 22}} color={COLORS.green} />
            : <Text style={styles.riskNumber}>{risk(patient?.twin.risk?.probability)}</Text>}
          <Text style={styles.riskStatus}>{patient?.twin.status ?? 'Workspace not connected'}</Text>
        </View>
        <View style={styles.orb}>
          <Text style={styles.orbHeart}>♥</Text>
          <Text style={styles.orbText}>{patient?.twin.quality.baseline_ready ? 'baseline ready' : 'building baseline'}</Text>
        </View>
      </View>

      <View style={styles.sectionHeading}>
        <View>
          <Text style={styles.sectionTitle}>Latest signals</Text>
          <Text style={styles.small}>{patient?.twin.timestamp ?? 'No patient loaded'}</Text>
        </View>
        <Pressable onPress={refresh}><Text style={styles.link}>Refresh</Text></Pressable>
      </View>

      <View style={styles.signalGrid}>
        {(patient?.twin.signals ?? []).slice(0, 6).map(signal => (
          <View style={styles.signalCard} key={signal.key}>
            <Text style={styles.signalLabel}>{signal.label}</Text>
            <Text style={styles.signalValue}>{signal.value == null ? '—' : Math.round(signal.value * 10) / 10}</Text>
            <Text style={styles.signalUnit}>{signal.unit}</Text>
          </View>
        ))}
      </View>

      <View style={styles.noteCard}>
        <Text style={styles.noteIcon}>↗</Text>
        <View style={{flex: 1}}>
          <Text style={styles.noteTitle}>Next wearable sync</Text>
          <Text style={styles.noteBody}>{patient?.twin.timestamp ? nextCalendarDay(patient.twin.timestamp) : 'Connect the workspace first'}</Text>
        </View>
        <Pressable onPress={openConnect}><Text style={styles.link}>Open</Text></Pressable>
      </View>
      <Text style={styles.disclaimer}>Research prototype · wearable connectivity does not make the model clinically validated.</Text>
    </ScrollView>
  )
}

function ReadingCard({reading}: {reading: DailySummary['readings'][number]}) {
  let value = reading.value
  let unit = reading.unit ?? ''
  if (reading.metric === 'sleep_minutes') {
    value = Math.round((reading.value / 60) * 10) / 10
    unit = 'h'
  }
  const title = {
    heart_rate: 'Resting HR',
    heart_rate_variability: 'HRV',
    respiratory_rate: 'Respiration',
    oxygen_saturation: 'SpO₂',
    steps: 'Steps',
    body_weight: 'Weight',
    systolic_bp: 'Systolic',
    diastolic_bp: 'Diastolic',
    sleep_minutes: 'Sleep',
  }[reading.metric]

  return (
    <View style={styles.readingCard}>
      <Text style={styles.signalLabel}>{title}</Text>
      <Text style={styles.readingValue}>{Number.isInteger(value) ? value : value.toFixed(1)} <Text style={styles.signalUnit}>{unit}</Text></Text>
      <Text style={styles.readingSource}>{reading.sourceMetric ?? nativeHealth.displayName}</Text>
    </View>
  )
}

function Connect({
  patient,
  settings,
  onSynced,
}: {
  patient: TwinResponse | null
  settings: Settings
  onSynced: () => Promise<void>
}) {
  const [availability, setAvailability] = useState<HealthAvailability | null>(null)
  const [summary, setSummary] = useState<DailySummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const syncDay = patient?.twin.timestamp ? nextCalendarDay(patient.twin.timestamp) : ''

  const loadAvailability = useCallback(async () => {
    try {
      setAvailability(await nativeHealth.checkAvailability())
    } catch (error) {
      setAvailability({
        available: false,
        label: 'Health service unavailable',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }, [])

  useEffect(() => { void loadAvailability() }, [loadAvailability])

  const grant = async () => {
    setBusy(true)
    try {
      const result = await nativeHealth.requestPermissions()
      setMessage(result.detail)
      await loadAvailability()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const preview = async () => {
    if (!syncDay) return
    setBusy(true)
    setMessage('')
    try {
      const next = await nativeHealth.readDailySummary(syncDay)
      setSummary(next)
      setMessage(`Found ${next.readings.length} usable daily signals. Review them before upload.`)
    } catch (error) {
      setSummary(null)
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const upload = async () => {
    if (!summary) return
    setBusy(true)
    setMessage('')
    try {
      await uploadSummary(settings.apiBase, settings.patientId, summary)
      setSummary(null)
      setMessage('Synced. CardioTwin recomputed this patient from the new daily summary.')
      await onSynced()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.eyebrow}>WEARABLE CONNECTION</Text>
      <Text style={styles.pageTitle}>Bring your day into the twin.</Text>
      <Text style={styles.body}>Permissions stay with {nativeHealth.displayName}. You decide when to preview and upload.</Text>

      <View style={styles.connectionCard}>
        <View style={styles.connectionHeader}>
          <View style={styles.connectionIcon}><Text style={styles.connectionIconText}>⌁</Text></View>
          <View style={{flex:1}}>
            <Text style={styles.connectionName}>{nativeHealth.displayName}</Text>
            <Text style={styles.small}>{availability?.label ?? 'Checking availability…'}</Text>
          </View>
          <View style={[styles.status, availability?.available ? styles.statusGood : styles.statusWarn]}>
            <Text style={styles.statusText}>{availability?.available ? 'Ready' : 'Setup'}</Text>
          </View>
        </View>
        <Text style={styles.noteBody}>{availability?.detail ?? 'Checking native health services.'}</Text>
        <Button title={busy ? 'Working…' : 'Grant / review access'} disabled={busy || !availability?.available} onPress={() => void grant()} />
        {!!availability?.action && <Button title="Open health settings" secondary onPress={() => void nativeHealth.openSettings()} />}
      </View>

      <View style={styles.darkCard}>
        <Text style={[styles.kicker, {color:'#B7C8C1'}]}>WHAT LEAVES YOUR PHONE</Text>
        {[
          'Read approved records for one day',
          'Reduce them to daily heart, sleep, activity and home-health signals',
          'Show you the summary before upload',
        ].map((item,index) => (
          <View style={styles.flowRow} key={item}>
            <Text style={styles.flowNumber}>0{index + 1}</Text>
            <Text style={styles.flowText}>{item}</Text>
          </View>
        ))}
      </View>

      <View style={styles.syncCard}>
        <Text style={styles.kicker}>NEXT EXPECTED DAY</Text>
        <Text style={styles.syncDate}>{syncDay || '—'}</Text>
        <Text style={styles.small}>The backend keeps a strictly ordered daily ledger, so the companion syncs exactly the next expected date.</Text>
        <Button title={busy ? 'Reading…' : 'Preview health data'} disabled={busy || !syncDay || !availability?.available} onPress={() => void preview()} />
      </View>

      {!!message && <View style={styles.message}><Text style={styles.noteBody}>{message}</Text></View>}

      {!!summary && (
        <>
          <View style={styles.sectionHeading}>
            <View>
              <Text style={styles.sectionTitle}>Review before upload</Text>
              <Text style={styles.small}>{summary.timestamp} · {nativeHealth.hrvLabel}</Text>
            </View>
            <Text style={styles.privateTag}>private preview</Text>
          </View>
          <View style={styles.readingGrid}>
            {summary.readings.map(item => <ReadingCard key={item.metric} reading={item} />)}
          </View>
          <Button title={busy ? 'Uploading…' : 'Upload daily summary'} disabled={busy} onPress={() => void upload()} />
          <Button title="Discard preview" secondary disabled={busy} onPress={() => setSummary(null)} />
        </>
      )}
    </ScrollView>
  )
}

function SettingsView({
  settings,
  save,
}: {
  settings: Settings
  save: (next: Settings) => Promise<void>
}) {
  const [draft, setDraft] = useState(settings)
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{flex:1}}>
      <ScrollView contentContainerStyle={styles.screen}>
        <Text style={styles.eyebrow}>COMPANION SETTINGS</Text>
        <Text style={styles.pageTitle}>Your connection, your control.</Text>
        <Text style={styles.body}>These settings stay on this phone. Raw health records are not stored by the companion.</Text>

        <View style={styles.formCard}>
          <Text style={styles.label}>CardioTwin API base URL</Text>
          <TextInput
            value={draft.apiBase}
            onChangeText={apiBase => setDraft(value => ({...value, apiBase}))}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={styles.input}
          />
          <Text style={styles.helper}>Use your computer LAN IP on a physical phone, e.g. http://192.168.1.23:8000.</Text>

          <Text style={styles.label}>Patient ID</Text>
          <TextInput
            value={draft.patientId}
            onChangeText={patientId => setDraft(value => ({...value, patientId}))}
            autoCapitalize="characters"
            autoCorrect={false}
            style={styles.input}
          />
          <Button
            title="Save settings"
            onPress={() => void save({
              ...draft,
              apiBase: draft.apiBase.trim(),
              patientId: draft.patientId.trim(),
            })}
          />
        </View>

        <Button title="Open health settings" secondary onPress={() => void nativeHealth.openSettings()} />
        <Button title="Open app settings" secondary onPress={() => void Linking.openSettings()} />
        <Text style={styles.disclaimer}>Use the development / preview build profile for local HTTP. Production builds should point to HTTPS.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

export default function App() {
  const [settings, setSettings] = useState<Settings>({
    ...DEFAULT_SETTINGS,
    apiBase: process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_SETTINGS.apiBase,
  })
  const [loaded, setLoaded] = useState(false)
  const [patient, setPatient] = useState<TwinResponse | null>(null)
  const [loadingPatient, setLoadingPatient] = useState(false)
  const [tab, setTab] = useState<Tab>('today')

  useEffect(() => {
    loadSettings().then(next => {
      setSettings(next)
      setLoaded(true)
    })
  }, [])

  const persist = async (next: Settings) => {
    setSettings(next)
    await saveSettings(next)
  }

  const refresh = useCallback(async () => {
    if (!settings.apiBase || !settings.patientId) return
    setLoadingPatient(true)
    try {
      setPatient(await getPatient(settings.apiBase, settings.patientId))
    } catch {
      setPatient(null)
    } finally {
      setLoadingPatient(false)
    }
  }, [settings.apiBase, settings.patientId])

  useEffect(() => {
    if (loaded && settings.onboardingComplete) void refresh()
  }, [loaded, settings.onboardingComplete, refresh])

  if (!loaded) {
    return <View style={[styles.safe,{alignItems:'center',justifyContent:'center'}]}><ActivityIndicator color={COLORS.green}/></View>
  }

  if (!settings.onboardingComplete) {
    return (
      <Onboarding
        settings={settings}
        onComplete={async next => {
          await persist(next)
          setTab('today')
        }}
      />
    )
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.topbar}>
        <Brand />
        <View style={styles.linkedPill}>
          <View style={[styles.linkedDot,{backgroundColor:patient ? COLORS.green : COLORS.clay}]}/>
          <Text style={styles.linkedText}>{patient ? 'workspace linked' : 'offline'}</Text>
        </View>
      </View>

      <View style={{flex:1}}>
        {tab === 'today' && <Today patient={patient} settings={settings} loading={loadingPatient} refresh={() => void refresh()} openConnect={() => setTab('connect')} />}
        {tab === 'connect' && <Connect patient={patient} settings={settings} onSynced={refresh} />}
        {tab === 'settings' && <SettingsView settings={settings} save={async next => {
          await persist(next)
          await refresh()
          Alert.alert('Saved','Companion settings updated.')
        }} />}
      </View>

      <View style={styles.tabs}>
        {([
          ['today','⌂','Today'],
          ['connect','⌁','Connect'],
          ['settings','⋯','Settings'],
        ] as const).map(([key,icon,label]) => (
          <Pressable key={key} onPress={() => setTab(key)} style={styles.tab}>
            <Text style={[styles.tabIcon, tab === key && styles.tabActive]}>{icon}</Text>
            <Text style={[styles.tabLabel, tab === key && styles.tabActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:COLORS.paper},
  onboarding:{padding:26,paddingBottom:48,minHeight:'100%'},
  screen:{padding:22,paddingBottom:42},
  topbar:{height:62,paddingHorizontal:20,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:COLORS.line},
  brandRow:{flexDirection:'row',alignItems:'center',gap:9},
  brandMark:{width:34,height:34,borderRadius:9,backgroundColor:COLORS.green,alignItems:'center',justifyContent:'center'},
  brandMarkText:{fontSize:12,fontWeight:'900',color:'#fff'},
  brandText:{fontSize:20,fontWeight:'800',letterSpacing:-.7,color:COLORS.ink},
  linkedPill:{flexDirection:'row',gap:6,alignItems:'center',backgroundColor:COLORS.card,paddingHorizontal:9,paddingVertical:6,borderRadius:99,borderWidth:1,borderColor:COLORS.line},
  linkedDot:{width:6,height:6,borderRadius:6},
  linkedText:{fontSize:9,fontWeight:'800',color:COLORS.muted},
  heroVisual:{height:270,alignItems:'center',justifyContent:'center',marginTop:32,marginBottom:24},
  heroOuter:{width:230,height:230,borderRadius:120,borderWidth:1,borderColor:'#C9D6CF',alignItems:'center',justifyContent:'center'},
  heroInner:{width:136,height:136,borderRadius:80,backgroundColor:COLORS.green,alignItems:'center',justifyContent:'center',shadowColor:'#1F453D',shadowOpacity:.17,shadowRadius:26,shadowOffset:{width:0,height:12}},
  heart:{fontSize:54,color:'#F8EEE8'},
  sensorBubble:{position:'absolute',minWidth:58,height:58,paddingHorizontal:7,borderRadius:30,backgroundColor:COLORS.card,borderWidth:1,borderColor:COLORS.line,alignItems:'center',justifyContent:'center'},
  sensorBubbleText:{fontSize:10,fontWeight:'800',color:COLORS.ink},
  eyebrow:{fontSize:10,fontWeight:'900',letterSpacing:1.5,color:COLORS.clay,marginBottom:11},
  heroTitle:{fontSize:38,lineHeight:41,fontWeight:'500',letterSpacing:-1.5,color:COLORS.ink},
  pageTitle:{fontSize:34,lineHeight:38,fontWeight:'500',letterSpacing:-1.3,color:COLORS.ink},
  body:{fontSize:14,lineHeight:22,color:COLORS.muted,marginTop:12,marginBottom:24},
  dots:{flexDirection:'row',gap:7,marginVertical:28},
  dot:{width:7,height:7,borderRadius:7,backgroundColor:'#D7D2C7'},
  dotActive:{width:24,backgroundColor:COLORS.green},
  formCard:{backgroundColor:COLORS.card,borderWidth:1,borderColor:COLORS.line,borderRadius:18,padding:18,marginTop:8},
  label:{fontSize:10,fontWeight:'900',letterSpacing:.8,color:COLORS.muted,marginTop:6,marginBottom:7},
  input:{minHeight:48,borderWidth:1,borderColor:'#D3CEC3',borderRadius:12,paddingHorizontal:13,fontSize:15,color:COLORS.ink,backgroundColor:'#FAF8F2',marginBottom:12},
  helper:{fontSize:11,lineHeight:17,color:COLORS.muted,marginBottom:10},
  button:{minHeight:50,borderRadius:14,alignItems:'center',justifyContent:'center',paddingHorizontal:16,marginTop:10},
  buttonPrimary:{backgroundColor:COLORS.ink},
  buttonSecondary:{backgroundColor:'transparent',borderWidth:1,borderColor:'#C9C5BA'},
  buttonText:{fontSize:14,fontWeight:'800',color:'#FFFDF8'},
  buttonTextSecondary:{color:COLORS.ink},
  disabled:{opacity:.38},
  riskCard:{borderRadius:24,padding:22,backgroundColor:'#E8EEE9',flexDirection:'row',justifyContent:'space-between',alignItems:'center'},
  kicker:{fontSize:9,fontWeight:'900',letterSpacing:1.3,color:COLORS.muted},
  riskNumber:{fontSize:58,lineHeight:65,fontWeight:'400',letterSpacing:-2.5,color:COLORS.clay,marginTop:8},
  riskStatus:{fontSize:12,fontWeight:'800',color:COLORS.ink},
  orb:{width:112,height:112,borderRadius:60,backgroundColor:'#D0DED6',alignItems:'center',justifyContent:'center'},
  orbHeart:{fontSize:38,color:COLORS.green},
  orbText:{fontSize:8,color:COLORS.green,marginTop:5},
  sectionHeading:{flexDirection:'row',alignItems:'flex-end',justifyContent:'space-between',marginTop:28,marginBottom:12},
  sectionTitle:{fontSize:20,fontWeight:'700',letterSpacing:-.4,color:COLORS.ink},
  small:{fontSize:11,lineHeight:17,color:COLORS.muted,marginTop:3},
  link:{fontSize:11,fontWeight:'900',color:COLORS.green},
  signalGrid:{flexDirection:'row',flexWrap:'wrap',gap:10},
  signalCard:{width:'48%',minHeight:108,borderRadius:16,padding:15,backgroundColor:COLORS.card,borderWidth:1,borderColor:COLORS.line},
  signalLabel:{fontSize:10,fontWeight:'700',color:COLORS.muted},
  signalValue:{fontSize:27,fontWeight:'550',color:COLORS.ink,marginTop:12},
  signalUnit:{fontSize:10,fontWeight:'500',color:COLORS.muted},
  noteCard:{marginTop:20,borderRadius:16,padding:16,backgroundColor:'#EEE9DE',flexDirection:'row',alignItems:'center',gap:12},
  noteIcon:{fontSize:24,color:COLORS.clay},
  noteTitle:{fontSize:13,fontWeight:'900',color:COLORS.ink},
  noteBody:{fontSize:12,lineHeight:18,color:COLORS.muted,marginTop:3},
  disclaimer:{fontSize:10,lineHeight:16,color:'#8D8C86',marginTop:24},
  connectionCard:{borderRadius:22,padding:18,backgroundColor:COLORS.card,borderWidth:1,borderColor:COLORS.line},
  connectionHeader:{flexDirection:'row',alignItems:'center',gap:12,marginBottom:12},
  connectionIcon:{width:46,height:46,borderRadius:14,backgroundColor:COLORS.greenSoft,alignItems:'center',justifyContent:'center'},
  connectionIconText:{fontSize:23,color:COLORS.green},
  connectionName:{fontSize:16,fontWeight:'900',color:COLORS.ink},
  status:{paddingHorizontal:9,paddingVertical:6,borderRadius:99},
  statusGood:{backgroundColor:COLORS.greenSoft},
  statusWarn:{backgroundColor:COLORS.claySoft},
  statusText:{fontSize:9,fontWeight:'900',color:COLORS.ink},
  darkCard:{marginTop:16,borderRadius:22,padding:18,backgroundColor:'#2B4740'},
  flowRow:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:13,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'rgba(255,255,255,.15)'},
  flowNumber:{fontSize:9,fontWeight:'900',color:'#AFC4BB'},
  flowText:{flex:1,fontSize:12,lineHeight:18,color:'#F6F3EA'},
  syncCard:{marginTop:16,borderRadius:22,padding:18,backgroundColor:COLORS.card,borderWidth:1,borderColor:COLORS.line},
  syncDate:{fontSize:33,fontWeight:'500',letterSpacing:-1,color:COLORS.ink,marginVertical:9},
  message:{marginTop:14,padding:14,borderRadius:14,backgroundColor:COLORS.claySoft},
  privateTag:{fontSize:9,fontWeight:'900',color:COLORS.green,backgroundColor:COLORS.greenSoft,paddingHorizontal:8,paddingVertical:5,borderRadius:99,overflow:'hidden'},
  readingGrid:{flexDirection:'row',flexWrap:'wrap',gap:10,marginBottom:8},
  readingCard:{width:'48%',minHeight:118,borderRadius:16,padding:14,backgroundColor:COLORS.card,borderWidth:1,borderColor:COLORS.line},
  readingValue:{fontSize:26,fontWeight:'550',color:COLORS.ink,marginTop:11},
  readingSource:{fontSize:9,lineHeight:13,color:'#8A877E',marginTop:8},
  tabs:{height:72,paddingBottom:6,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:COLORS.line,backgroundColor:COLORS.card,flexDirection:'row',alignItems:'center',justifyContent:'space-around'},
  tab:{alignItems:'center',justifyContent:'center',minWidth:78,gap:2},
  tabIcon:{fontSize:22,color:'#8A8C87'},
  tabLabel:{fontSize:9,fontWeight:'800',color:'#8A8C87'},
  tabActive:{color:COLORS.green},
})
