import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Button, FlatList, Linking, Platform,
  SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as ImagePicker from 'expo-image-picker';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
import { api } from './src/api';
import { getBaseUrl, setBaseUrl, getToken, setToken, getUser, setUser, clearSession } from './src/session';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }),
});

// Status buttons follow the server STATUS_TRANSITIONS map for the field flow.
const NEXT_STATUS = {
  assigned: ['in_progress', 'waiting_customer'],
  in_progress: ['resolved', 'waiting_customer'],
  waiting_customer: ['in_progress', 'resolved'],
  reopened: ['in_progress', 'assigned'],
};
const STATUS_LABEL = { in_progress: 'Start Work', resolved: 'Mark Resolved', waiting_customer: 'Waiting Customer', assigned: 'Accept' };

const STATUS_COLOR = {
  assigned: '#f59e0b',
  in_progress: '#2563eb',
  resolved: '#16a34a',
  waiting_customer: '#7c3aed',
  closed: '#475569',
};

const REPORT_TEMPLATES = [
  'Fiber splicing done',
  'ONU reset & checked',
  'Drop wire replaced',
  'Router reconfigured',
  'Power level checked (OK)',
];

export default function App() {
  const [screen, setScreen] = useState('boot'); // boot|setup|login|list|detail
  const [baseUrl, setBaseUrlState] = useState('');
  const [user, setUserState] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [note, setNote] = useState('');
  const [comment, setComment] = useState('');
  const [updating, setUpdating] = useState(false);
  const lastNotifResponse = useRef(null);

  const checkForOtaUpdate = async () => {
    try {
      if (!Updates.isEnabled) return;
      const update = await Updates.checkForUpdateAsync();
      if (update.isAvailable) {
        setUpdating(true);
        await Updates.fetchUpdateAsync();
        await Updates.reloadAsync();
      }
    } catch {
      // Dev / Expo Go where updates are unsupported must not crash.
    } finally {
      setUpdating(false);
    }
  };

  useEffect(() => {
    (async () => {
      await checkForOtaUpdate();
      const savedUrl = await getBaseUrl();
      const token = await getToken();
      if (!savedUrl) { setScreen('setup'); return; }
      setBaseUrlState(savedUrl);
      if (token) {
        try {
          const u = await getUser();
          setUserState(u);
          setScreen('list');
          loadTickets();
        } catch { setScreen('login'); }
      } else setScreen('login');
    })();
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      lastNotifResponse.current = r;
      const ticketId = r.notification.request.content.data?.ticketId;
      if (ticketId) openTicket(ticketId);
    });
    return () => sub.remove();
  }, []);

  const withLoading = async (fn) => {
    setLoading(true);
    try { await fn(); } catch (e) {
      const msg = e?.message || 'Request failed';
      if (msg.startsWith('UPDATE_REQUIRED:')) {
        const serverMsg = msg.slice('UPDATE_REQUIRED:'.length).trim();
        Alert.alert('New version available — please install the latest APK', serverMsg || 'Please update your app.');
      } else if (msg.startsWith('SESSION_EXPIRED:')) {
        try { await clearSession(); } catch {}
        setUserState(null); setTickets([]); setDetail(null);
        setScreen('login');
        Alert.alert('Session expired', 'Please login again.');
      } else {
        Alert.alert('Error', msg);
      }
    } finally { setLoading(false); }
  };

  const saveServer = async () => {
    const url = baseUrl.trim().replace(/\/+$/, '');
    if (!url) return Alert.alert('Error', 'Enter server URL');
    const isHttps = /^https:\/\//i.test(url);
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url);
    if (!/^https?:\/\//i.test(url)) return Alert.alert('Error', 'URL must start with https:// (or http:// for local testing only)');
    if (!isHttps && !isLocal) return Alert.alert('Error', 'Only HTTPS URLs are allowed outside your local network.');
    if (!isHttps) {
      Alert.alert('Warning: insecure connection', 'This test server uses plain HTTP — logins can be overheard on WiFi. Never use it for real work.');
    }
    await setBaseUrl(url);
    setScreen('login');
  };

  const doLogin = () => withLoading(async () => {
    const res = await api.login(identifier.trim(), password);
    if (!res?.token) throw new Error('Login failed: no token');
    await setToken(res.token);
    await setUser(res.user);
    setUserState(res.user);
    setIdentifier(''); setPassword('');
    setScreen('list');
    loadTickets();
    registerPush();
  });

  const doLogout = () => withLoading(async () => {
    try {
      const t = await getExpoPushTokenSafe();
      if (t) await api.unregisterDevice(t);
    } catch { /* best effort */ }
    await clearSession();
    setUserState(null); setTickets([]); setDetail(null);
    setScreen('login');
  });

  const getExpoPushTokenSafe = async () => {
    try {
      if (Platform.OS === 'web') return null;
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') return null;
      const projectId = Constants?.expoConfig?.extra?.eas?.projectId;
      const t = projectId
        ? await Notifications.getExpoPushTokenAsync({ projectId })
        : await Notifications.getExpoPushTokenAsync();
      return t.data;
    } catch { return null; }
  };

  const registerPush = async () => {
    try {
      const t = await getExpoPushTokenSafe();
      if (t) await api.registerDevice(t, Platform.OS);
    } catch (e) { console.log('[push] register skipped:', e.message); }
  };

  const loadTickets = () => withLoading(async () => {
    const data = await api.myTickets();
    setTickets(data?.rows || (Array.isArray(data) ? data : []));
  });

  const openTicket = (id) => withLoading(async () => {
    const data = await api.ticket(id);
    setDetail(data);
    setNote(''); setComment('');
    setScreen('detail');
  });

  const changeStatus = (status) => withLoading(async () => {
    const patch = { status };
    if (note.trim()) {
      patch.note = note.trim();
      if (status === 'resolved') patch.resolution_note = note.trim();
    }
    if (status === 'resolved' && !note.trim()) {
      return Alert.alert('Report required', 'Please write or select what work was done.');
    }
    const updated = await api.updateTicket(detail.ticket.id, patch);
    setDetail((d) => ({ ...d, ticket: updated }));
    setNote('');
    Alert.alert('Updated', `Ticket is now ${status}`);
  });

  const sendComment = () => withLoading(async () => {
    if (!comment.trim()) return;
    await api.addComment(detail.ticket.id, comment.trim());
    setComment('');
    openTicket(detail.ticket.id);
  });

  const checkPhotoAsset = (asset) => {
    if (asset?.fileSize && asset.fileSize > 10 * 1024 * 1024) {
      Alert.alert('Too large', 'Photo must be 10 MB or smaller.');
      return null;
    }
    const name = String(asset?.fileName || asset?.uri || '').toLowerCase();
    const okExt = /\.(jpe?g|png|webp|gif|heic|heif)$/.test(name);
    if (!okExt) {
      Alert.alert('Invalid file', 'Please choose a photo (JPG/PNG/WebP).');
      return null;
    }
    return asset;
  };

  const attachPhoto = () => withLoading(async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    if (picked.canceled) return;
    const asset = checkPhotoAsset(picked.assets[0]);
    if (!asset) return;
    await api.uploadPhoto(detail.ticket.id, asset.uri, asset.fileName);
    Alert.alert('Done', 'Photo attached');
    openTicket(detail.ticket.id);
  });

  const takePhoto = () => withLoading(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert('Error', 'Camera permission needed');
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (shot.canceled) return;
    const asset = checkPhotoAsset(shot.assets[0]);
    if (!asset) return;
    await api.uploadPhoto(detail.ticket.id, asset.uri, asset.fileName);
    Alert.alert('Done', 'Photo attached');
    openTicket(detail.ticket.id);
  });

  const makePhoneCall = (phone) => {
    if (!phone) return;
    Linking.openURL(`tel:${phone}`);
  };

  const openWhatsApp = (phone) => {
    if (!phone) return;
    const clean = String(phone).replace(/^0+/, '');
    Linking.openURL(`https://wa.me/880${clean}`);
  };

  const openMapAddress = (addr) => {
    if (!addr) return;
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr + ' Khulna Bangladesh')}`);
  };

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="dark" />
      <View style={s.header}>
        <Text style={s.title}>SpeedNet Technician</Text>
        {user && <Text style={s.sub}>{user.full_name || ''}</Text>}
      </View>
      {loading && <ActivityIndicator size="large" style={s.loader} />}
      {updating && (
        <View style={s.updating}>
          <ActivityIndicator size="large" />
          <Text style={s.updatingText}>Updating app…</Text>
        </View>
      )}

      {screen === 'setup' && (
        <View style={s.box}>
          <Text style={s.label}>Office server URL</Text>
          <TextInput style={s.input} value={baseUrl} onChangeText={setBaseUrlState}
            placeholder="https://office.example.com" autoCapitalize="none" />
          <Button title="Save & Continue" onPress={saveServer} />
        </View>
      )}

      {screen === 'login' && (
        <View style={s.box}>
          <Text style={s.label}>Employee ID / Phone</Text>
          <TextInput style={s.input} value={identifier} onChangeText={setIdentifier} autoCapitalize="none" />
          <Text style={s.label}>Password</Text>
          <TextInput style={s.input} value={password} onChangeText={setPassword} secureTextEntry />
          <Button title="Login" onPress={doLogin} />
        </View>
      )}

      {screen === 'list' && (
        <View style={s.flex}>
          <View style={s.row}>
            <Button title="Refresh" onPress={loadTickets} />
            <Button title="Logout" onPress={doLogout} color="#888" />
          </View>
          <Text style={s.count}>My tickets ({tickets.length})</Text>
          <FlatList data={tickets} keyExtractor={(t) => String(t.id)}
            renderItem={({ item }) => {
              const statusColor = STATUS_COLOR[item.status] || '#2563eb';
              return (
                <TouchableOpacity style={s.card} onPress={() => openTicket(item.id)}>
                  <View style={s.cardHeader}>
                    <Text style={s.cardTitle}>{item.ticket_no}</Text>
                    <View style={[s.badge, { backgroundColor: statusColor }]}>
                      <Text style={s.badgeText}>{item.status}</Text>
                    </View>
                  </View>
                  <Text numberOfLines={1} style={s.cardSubject}>{item.subject || ''}</Text>
                  <Text style={s.muted}>{item.pppoe_username || ''} · {item.phone || ''}</Text>
                </TouchableOpacity>
              );
            }} />
        </View>
      )}

      {screen === 'detail' && detail && (
        <ScrollView style={s.flex}>
          <Button title="← Back to List" onPress={() => { setScreen('list'); loadTickets(); }} />
          <Text style={s.detailTitle}>{detail.ticket.ticket_no}</Text>
          <View style={s.statusRow}>
            <View style={[s.badge, { backgroundColor: STATUS_COLOR[detail.ticket.status] || '#2563eb' }]}>
              <Text style={s.badgeText}>{detail.ticket.status}</Text>
            </View>
            <Text style={s.prioText}>Priority: {detail.ticket.priority || 'medium'}</Text>
          </View>

          <View style={s.infoCard}>
            <Text style={s.infoLabel}>Customer Info</Text>
            <Text style={s.infoVal}>{detail.ticket.pppoe_username || '-'}</Text>

            {detail.ticket.phone ? (
              <View style={s.actionBtnRow}>
                <TouchableOpacity style={s.callBtn} onPress={() => makePhoneCall(detail.ticket.phone)}>
                  <Text style={s.callBtnText}>📞 Call {detail.ticket.phone}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.waBtn} onPress={() => openWhatsApp(detail.ticket.phone)}>
                  <Text style={s.waBtnText}>💬 WhatsApp</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {detail.ticket.address ? (
              <View style={s.mt8}>
                <Text style={s.infoLabel}>Address</Text>
                <Text style={s.infoVal}>{detail.ticket.address}</Text>
                <TouchableOpacity style={s.mapBtn} onPress={() => openMapAddress(detail.ticket.address)}>
                  <Text style={s.mapBtnText}>📍 Open in Google Maps</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>

          <Text style={s.mt}>Subject: {detail.ticket.subject || ''}</Text>
          <Text style={s.descText}>{detail.ticket.description || ''}</Text>

          <Text style={s.section}>Update Status & Work Report</Text>
          <Text style={s.subLabel}>Tap quick template or type report:</Text>
          <View style={s.chipRow}>
            {REPORT_TEMPLATES.map((tmpl) => (
              <TouchableOpacity key={tmpl} style={s.chip} onPress={() => setNote((prev) => (prev ? `${prev}, ${tmpl}` : tmpl))}>
                <Text style={s.chipText}>+ {tmpl}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={s.input}
            value={note}
            onChangeText={setNote}
            placeholder="Work note / report details…"
            multiline
          />
          <View style={s.btnRow}>
            {(NEXT_STATUS[detail.ticket.status] || []).map((st) => (
              <View key={st} style={s.btnWrap}>
                <Button title={STATUS_LABEL[st] || st} onPress={() => changeStatus(st)} />
              </View>
            ))}
          </View>

          <Text style={s.section}>Comments</Text>
          <TextInput style={s.input} value={comment} onChangeText={setComment} placeholder="Add comment…" multiline />
          <Button title="Send Comment" onPress={sendComment} />

          <Text style={s.section}>Photos ({(detail.attachments || []).length})</Text>
          <View style={s.btnRow}>
            <View style={s.btnWrap}><Button title="Take Photo" onPress={takePhoto} /></View>
            <View style={s.btnWrap}><Button title="Upload Photo" onPress={attachPhoto} /></View>
          </View>
          {(detail.attachments || []).map((a) => (
            <Text key={a.id} style={s.muted}>• {a.file_name}</Text>
          ))}

          <Text style={s.section}>History Timeline</Text>
          {(detail.events || []).slice().reverse().map((e) => (
            <Text key={e.id} style={s.muted}>• [{e.event_type}] {e.message}</Text>
          ))}
          <View style={s.spacer} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc', paddingTop: 8 },
  flex: { flex: 1, padding: 12 },
  header: { padding: 12, borderBottomWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#fff' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#1d4ed8' },
  sub: { color: '#64748b' },
  loader: { marginVertical: 8 },
  updating: { alignItems: 'center', padding: 12 },
  updatingText: { marginTop: 8, color: '#1d4ed8', fontWeight: '600' },
  box: { padding: 20, gap: 8, backgroundColor: '#fff', borderRadius: 12, margin: 12 },
  label: { fontWeight: '600', marginTop: 8, color: '#334155' },
  subLabel: { fontSize: 12, color: '#64748b', marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 10, marginVertical: 6, backgroundColor: '#fff', fontSize: 14 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  count: { fontWeight: '700', marginBottom: 8, color: '#1e293b' },
  card: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 12, marginBottom: 10, backgroundColor: '#fff' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cardTitle: { fontWeight: 'bold', fontSize: 15, color: '#0f172a' },
  cardSubject: { fontSize: 13, color: '#334155', marginVertical: 2 },
  muted: { color: '#64748b', fontSize: 12 },
  detailTitle: { fontSize: 20, fontWeight: 'bold', marginVertical: 8, color: '#0f172a' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  prioText: { fontSize: 13, color: '#64748b', textTransform: 'capitalize' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { color: '#fff', fontWeight: 'bold', fontSize: 11, textTransform: 'uppercase' },
  infoCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 12, marginVertical: 8 },
  infoLabel: { fontSize: 11, fontWeight: 'bold', color: '#64748b', textTransform: 'uppercase' },
  infoVal: { fontSize: 15, fontWeight: 'bold', color: '#0f172a', marginBottom: 6 },
  actionBtnRow: { flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  callBtn: { backgroundColor: '#eff6ff', borderWith: 1, borderColor: '#bfdbfe', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  callBtnText: { color: '#1d4ed8', fontWeight: 'bold', fontSize: 13 },
  waBtn: { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  waBtnText: { color: '#16a34a', fontWeight: 'bold', fontSize: 13 },
  mapBtn: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginTop: 6 },
  mapBtnText: { color: '#334155', fontWeight: 'bold', fontSize: 12 },
  mt: { marginTop: 10, fontWeight: 'bold', color: '#1e293b' },
  mt8: { marginTop: 8 },
  descText: { fontSize: 14, color: '#334155', marginVertical: 4 },
  section: { fontWeight: 'bold', marginTop: 18, marginBottom: 6, color: '#0f172a', fontSize: 15 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 6 },
  btnWrap: { marginRight: 8, marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 4 },
  chip: { backgroundColor: '#eff6ff', borderColor: '#bfdbfe', borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { color: '#1d4ed8', fontSize: 12, fontWeight: '600' },
  spacer: { height: 40 },
});
