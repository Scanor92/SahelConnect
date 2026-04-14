import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";

const API_BASE_URL = "http://192.168.1.87:5000";

function emptyLine() {
  return { productName: "", quantity: "", unitPrice: "" };
}

function parseItemsFromSale(sale) {
  if (Array.isArray(sale?.items) && sale.items.length > 0) {
    return sale.items;
  }

  if (sale?.productName) {
    return [
      {
        productName: sale.productName,
        quantity: Number(sale.quantity || 0),
        unitPrice: Number(sale.unitPrice || 0),
        lineTotal: Number(sale.quantity || 0) * Number(sale.unitPrice || 0),
      },
    ];
  }

  return [];
}

function normalizeOwnerId(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value._id) {
    return String(value._id);
  }
  return String(value);
}

function normalizeLine(line) {
  const quantity = Number(line.quantity);
  const unitPrice = Number(line.unitPrice);

  return {
    productName: String(line.productName || "").trim(),
    quantity,
    unitPrice,
  };
}

function linesTotal(lines) {
  return lines.reduce((sum, line) => {
    const qty = Number(line.quantity || 0);
    const price = Number(line.unitPrice || 0);
    if (Number.isNaN(qty) || Number.isNaN(price)) {
      return sum;
    }
    return sum + qty * price;
  }, 0);
}

function formatYmd(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseYmd(value) {
  if (!value) {
    return new Date();
  }
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return new Date();
  }
  return date;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function monthLabel(date) {
  return date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

export default function App() {
  const [authToken, setAuthToken] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const [loginEmail, setLoginEmail] = useState("admin@sahelconnect.com");
  const [loginPassword, setLoginPassword] = useState("Admin@1234");
  const [loggingIn, setLoggingIn] = useState(false);

  const [tab, setTab] = useState("home");
  const [sales, setSales] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingCreate, setLoadingCreate] = useState(false);
  const [downloadingId, setDownloadingId] = useState("");
  const [previewingId, setPreviewingId] = useState("");
  const [searchText, setSearchText] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [reportScreen, setReportScreen] = useState("menu");
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [weeklyDate, setWeeklyDate] = useState(new Date().toISOString().slice(0, 10));
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [calendarTarget, setCalendarTarget] = useState("from");
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [dailyReport, setDailyReport] = useState(null);
  const [weeklyReport, setWeeklyReport] = useState(null);
  const [rangeReport, setRangeReport] = useState(null);
  const [showDailyDetails, setShowDailyDetails] = useState(false);
  const [showWeeklyDetails, setShowWeeklyDetails] = useState(false);
  const [showRangeDetails, setShowRangeDetails] = useState(false);
  const [loadingDailyReport, setLoadingDailyReport] = useState(false);
  const [loadingWeeklyReport, setLoadingWeeklyReport] = useState(false);
  const [loadingRangeReport, setLoadingRangeReport] = useState(false);
  const [exportingReport, setExportingReport] = useState("");

  const [productLines, setProductLines] = useState([emptyLine()]);

  const [editingId, setEditingId] = useState("");
  const [editLines, setEditLines] = useState([emptyLine()]);
  const [savingEdit, setSavingEdit] = useState(false);

  const currentUserId = useMemo(() => normalizeOwnerId(currentUser?.id), [currentUser]);

  function withTimeout(promise, timeoutMs = 12000) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), timeoutMs)),
    ]);
  }

  async function requestJson(path, options = {}, timeoutMs = 12000) {
    const headers = {
      ...(options.headers || {}),
    };
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    const response = await withTimeout(
      fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers,
      }),
      timeoutMs
    );
    let data = {};

    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok) {
      throw new Error(data.message || "Erreur serveur");
    }

    return data;
  }

  useEffect(() => {
    if (!authToken) {
      return;
    }
    loadSales();
    loadDailyReport(reportDate);
    loadWeeklyReport(weeklyDate);
  }, [authToken]);

  useEffect(() => {
    if (!authToken) {
      return;
    }
    if (tab === "history" || tab === "home") {
      loadSales();
      if (tab === "home") {
        loadDailyReport(reportDate);
        loadWeeklyReport(weeklyDate);
      }
    }
  }, [tab, authToken]);

  async function handleLogin() {
    if (!loginEmail || !loginPassword) {
      Alert.alert("Erreur", "Email et mot de passe obligatoires.");
      return;
    }
    setLoggingIn(true);
    try {
      const data = await requestJson("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      setAuthToken(data.token);
      setCurrentUser(data.user);
      Alert.alert("Succes", `Bienvenue ${data.user.fullName}`);
    } catch (error) {
      Alert.alert("Connexion echouee", error.message || "Identifiants invalides.");
    } finally {
      setLoggingIn(false);
    }
  }

  function handleLogout() {
    setAuthToken("");
    setCurrentUser(null);
    setTab("home");
  }

  const createTotal = useMemo(() => linesTotal(productLines), [productLines]);
  const editTotal = useMemo(() => linesTotal(editLines), [editLines]);

  const totalAmount = useMemo(() => {
    return sales.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);
  }, [sales]);

  async function loadSales(filters = {}) {
    setLoadingHistory(true);
    try {
      const params = new URLSearchParams();
      if (filters.q) {
        params.append("q", filters.q);
      }
      if (filters.from) {
        params.append("from", filters.from);
      }
      if (filters.to) {
        params.append("to", filters.to);
      }

      const query = params.toString();
      const data = await requestJson(`/api/sales${query ? `?${query}` : ""}`, {}, 12000);
      setSales(data.sales || []);
    } catch (error) {
      Alert.alert("Erreur", error.message || "Impossible de charger les ventes.");
    } finally {
      setLoadingHistory(false);
    }
  }

  async function loadDailyReport(dateValue) {
    setLoadingDailyReport(true);
    try {
      const safeDate = dateValue || new Date().toISOString().slice(0, 10);
      const data = await requestJson(`/api/sales/reports/daily?date=${encodeURIComponent(safeDate)}`);
      setDailyReport(data);
      return true;
    } catch (error) {
      Alert.alert("Erreur", error.message || "Impossible de charger le rapport journalier.");
      return false;
    } finally {
      setLoadingDailyReport(false);
    }
  }

  async function loadWeeklyReport(dateValue) {
    setLoadingWeeklyReport(true);
    try {
      const safeDate = dateValue || new Date().toISOString().slice(0, 10);
      const data = await requestJson(`/api/sales/reports/weekly?date=${encodeURIComponent(safeDate)}`);
      setWeeklyReport(data);
      return true;
    } catch (error) {
      Alert.alert("Erreur", error.message || "Impossible de charger le rapport hebdomadaire.");
      return false;
    } finally {
      setLoadingWeeklyReport(false);
    }
  }

  async function loadRangeReport() {
    if (!rangeFrom || !rangeTo) {
      Alert.alert("Erreur", "Renseignez from et to (YYYY-MM-DD).");
      return false;
    }

    setLoadingRangeReport(true);
    try {
      const data = await requestJson(
        `/api/sales/reports/range?from=${encodeURIComponent(rangeFrom)}&to=${encodeURIComponent(rangeTo)}`
      );
      setRangeReport(data);
      return true;
    } catch (error) {
      Alert.alert("Erreur", error.message || "Impossible de charger le rapport par intervalle.");
      return false;
    } finally {
      setLoadingRangeReport(false);
    }
  }

  async function applyHistoryFilters() {
    await loadSales({
      q: searchText.trim(),
      from: filterFrom.trim(),
      to: filterTo.trim(),
    });
  }

  async function resetHistoryFilters() {
    setSearchText("");
    setFilterFrom("");
    setFilterTo("");
    await loadSales();
  }

  function updateCreateLine(index, key, value) {
    setProductLines((prev) => prev.map((line, i) => (i === index ? { ...line, [key]: value } : line)));
  }

  function addCreateLine() {
    setProductLines((prev) => [...prev, emptyLine()]);
  }

  function removeCreateLine(index) {
    setProductLines((prev) => {
      if (prev.length === 1) {
        return prev;
      }
      return prev.filter((_, i) => i !== index);
    });
  }

  function updateEditLine(index, key, value) {
    setEditLines((prev) => prev.map((line, i) => (i === index ? { ...line, [key]: value } : line)));
  }

  function addEditLine() {
    setEditLines((prev) => [...prev, emptyLine()]);
  }

  function removeEditLine(index) {
    setEditLines((prev) => {
      if (prev.length === 1) {
        return prev;
      }
      return prev.filter((_, i) => i !== index);
    });
  }

  function sanitizeLines(lines) {
    return lines
      .map(normalizeLine)
      .filter((line) => line.productName || line.quantity || line.unitPrice);
  }

  function validateLines(lines) {
    if (!Array.isArray(lines) || lines.length === 0) {
      return "Ajoutez au moins un produit";
    }

    for (const line of lines) {
      if (!line.productName) {
        return "Chaque ligne doit contenir un nom produit";
      }
      if (Number.isNaN(line.quantity) || line.quantity <= 0) {
        return "Chaque ligne doit contenir une quantite valide";
      }
      if (Number.isNaN(line.unitPrice) || line.unitPrice < 0) {
        return "Chaque ligne doit contenir un prix unitaire valide";
      }
    }

    return null;
  }

  async function handleCreateSale() {
    const lines = sanitizeLines(productLines);
    const validationError = validateLines(lines);

    if (validationError) {
      Alert.alert("Erreur", validationError);
      return;
    }

    setLoadingCreate(true);
    try {
      await requestJson("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: lines }),
      });

      setProductLines([emptyLine()]);
      await loadSales();
      setTab("history");
      Alert.alert("Succes", "Vente enregistree.");
    } catch (error) {
      Alert.alert("Erreur", error.message || "Impossible d'enregistrer la vente.");
    } finally {
      setLoadingCreate(false);
    }
  }

  function startEdit(item) {
    const ownerId = normalizeOwnerId(item?.createdBy);
    if (!ownerId || ownerId !== currentUserId) {
      Alert.alert("Action non autorisee", "Vous pouvez modifier uniquement vos ventes.");
      return;
    }

    setEditingId(item._id);
    const lines = parseItemsFromSale(item).map((line) => ({
      productName: line.productName,
      quantity: String(line.quantity),
      unitPrice: String(line.unitPrice),
    }));

    setEditLines(lines.length > 0 ? lines : [emptyLine()]);
  }

  function cancelEdit() {
    setEditingId("");
    setEditLines([emptyLine()]);
  }

  async function saveEdit() {
    if (!editingId) {
      return;
    }

    const lines = sanitizeLines(editLines);
    const validationError = validateLines(lines);

    if (validationError) {
      Alert.alert("Erreur", validationError);
      return;
    }

    setSavingEdit(true);
    try {
      await requestJson(`/api/sales/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: lines }),
      });

      cancelEdit();
      await loadSales();
      Alert.alert("Succes", "Vente modifiee.");
    } catch (error) {
      Alert.alert("Erreur", error.message || "Impossible de modifier la vente.");
    } finally {
      setSavingEdit(false);
    }
  }

  function confirmDelete(id) {
    const sale = sales.find((s) => s._id === id);
    const ownerId = normalizeOwnerId(sale?.createdBy);
    if (!ownerId || ownerId !== currentUserId) {
      Alert.alert("Action non autorisee", "Vous pouvez supprimer uniquement vos ventes.");
      return;
    }

    Alert.alert("Confirmation", "Supprimer cette vente ?", [
      { text: "Annuler", style: "cancel" },
      {
        text: "Supprimer",
        style: "destructive",
        onPress: async () => {
          try {
            await requestJson(`/api/sales/${id}`, { method: "DELETE" });
            if (editingId === id) {
              cancelEdit();
            }
            await loadSales();
          } catch (error) {
            Alert.alert("Erreur", error.message || "Suppression impossible.");
          }
        },
      },
    ]);
  }

  async function downloadAndShareReceipt(id, name) {
    try {
      setDownloadingId(id);
      const safeName = String(name || "produit").replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
      const fileUri = `${FileSystem.documentDirectory}recu-${safeName}-${id}.pdf`;
      const remoteUrl = `${API_BASE_URL}/api/sales/${id}/receipt`;

      await withTimeout(FileSystem.downloadAsync(remoteUrl, fileUri), 15000);

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, {
          mimeType: "application/pdf",
          dialogTitle: "Envoyer le recu",
          UTI: "com.adobe.pdf",
        });
      } else {
        Alert.alert("Telechargement termine", `Recu sauvegarde: ${fileUri}`);
      }
    } catch (error) {
      if (error.message === "TIMEOUT") {
        Alert.alert("Timeout", "Le telechargement du recu a pris trop de temps.");
      } else {
        Alert.alert("Erreur", "Impossible de telecharger le recu PDF.");
      }
    } finally {
      setDownloadingId("");
    }
  }

  async function openReceiptPreview(id) {
    try {
      setPreviewingId(id);
      const url = `${API_BASE_URL}/api/sales/${id}/receipt`;
      const canOpen = await Linking.canOpenURL(url);

      if (!canOpen) {
        Alert.alert("Erreur", "Impossible d'ouvrir l'apercu du recu.");
        return;
      }

      await Linking.openURL(url);
    } catch {
      Alert.alert("Erreur", "Impossible d'ouvrir l'apercu du recu.");
    } finally {
      setPreviewingId("");
    }
  }

  async function exportReportPdf(path, filename, exportKey) {
    try {
      setExportingReport(exportKey);
      const timestamp = Date.now();
      const freshPath = `${path}${path.includes("?") ? "&" : "?"}_t=${timestamp}`;
      const finalFilename = filename.replace(/\.pdf$/i, `-${timestamp}.pdf`);
      const fileUri = `${FileSystem.documentDirectory}${finalFilename}`;
      await withTimeout(FileSystem.downloadAsync(`${API_BASE_URL}${freshPath}`, fileUri), 20000);

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, {
          mimeType: "application/pdf",
          dialogTitle: "Partager le rapport PDF",
          UTI: "com.adobe.pdf",
        });
      } else {
        Alert.alert("Export termine", `Rapport sauvegarde: ${fileUri}`);
      }
    } catch (error) {
      if (error.message === "TIMEOUT") {
        Alert.alert("Timeout", "L'export du rapport a pris trop de temps.");
      } else {
        Alert.alert("Erreur", "Impossible d'exporter le rapport PDF.");
      }
    } finally {
      setExportingReport("");
    }
  }

  async function previewReportPdf(path) {
    try {
      const timestamp = Date.now();
      const freshPath = `${path}${path.includes("?") ? "&" : "?"}_t=${timestamp}`;
      const url = `${API_BASE_URL}${freshPath}`;
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        Alert.alert("Erreur", "Impossible d'ouvrir l'aperçu PDF.");
        return;
      }
      await Linking.openURL(url);
    } catch {
      Alert.alert("Erreur", "Impossible d'ouvrir l'aperçu PDF.");
    }
  }

  function openCalendar(target) {
    setCalendarTarget(target);
    const seed = target === "from" ? parseYmd(rangeFrom) : parseYmd(rangeTo);
    setCalendarMonth(startOfMonth(seed));
    setCalendarVisible(true);
  }

  function onPickDate(dateValue) {
    const picked = formatYmd(dateValue);
    if (calendarTarget === "from") {
      setRangeFrom(picked);
    } else {
      setRangeTo(picked);
    }
    setCalendarVisible(false);
  }

  function renderCalendarModal() {
    const monthStart = startOfMonth(calendarMonth);
    const monthEnd = endOfMonth(calendarMonth);
    const firstWeekday = (monthStart.getDay() + 6) % 7;
    const totalDays = monthEnd.getDate();
    const cells = [];

    for (let i = 0; i < firstWeekday; i += 1) {
      cells.push({ type: "empty", key: `e-${i}` });
    }
    for (let day = 1; day <= totalDays; day += 1) {
      const dateObj = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day);
      cells.push({ type: "day", key: `d-${day}`, day, dateObj });
    }

    return (
      <Modal visible={calendarVisible} transparent animationType="fade" onRequestClose={() => setCalendarVisible(false)}>
        <View style={styles.calendarOverlay}>
          <View style={styles.calendarCard}>
            <View style={styles.calendarHeader}>
              <TouchableOpacity
                style={styles.calendarNavBtn}
                onPress={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}
              >
                <Text style={styles.calendarNavText}>{"<"}</Text>
              </TouchableOpacity>
              <Text style={styles.calendarTitle}>{monthLabel(calendarMonth)}</Text>
              <TouchableOpacity
                style={styles.calendarNavBtn}
                onPress={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}
              >
                <Text style={styles.calendarNavText}>{">"}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.calendarWeekRow}>
              {["Lu", "Ma", "Me", "Je", "Ve", "Sa", "Di"].map((d) => (
                <Text key={d} style={styles.calendarWeekLabel}>{d}</Text>
              ))}
            </View>

            <View style={styles.calendarGrid}>
              {cells.map((cell) => {
                if (cell.type === "empty") {
                  return <View key={cell.key} style={styles.calendarDayCell} />;
                }
                const selected = (calendarTarget === "from" ? rangeFrom : rangeTo) === formatYmd(cell.dateObj);
                return (
                  <TouchableOpacity
                    key={cell.key}
                    style={[styles.calendarDayCell, selected && styles.calendarDayCellSelected]}
                    onPress={() => onPickDate(cell.dateObj)}
                  >
                    <Text style={[styles.calendarDayText, selected && styles.calendarDayTextSelected]}>{cell.day}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity style={styles.cancelButton} onPress={() => setCalendarVisible(false)}>
              <Text style={styles.cancelButtonText}>Fermer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  function renderReportDetails(report) {
    const reportSales = Array.isArray(report?.sales) ? report.sales : [];
    if (reportSales.length === 0) {
      return <Text style={styles.emptyText}>Aucune vente dans cette periode.</Text>;
    }

    return (
      <View style={styles.reportDetailsWrap}>
        {reportSales.map((sale) => {
          const items = parseItemsFromSale(sale);
          return (
            <View key={sale._id} style={styles.reportSaleItem}>
              <Text style={styles.reportSaleTitle}>Vente #{String(sale._id).slice(-6)}</Text>
              <Text style={styles.reportSaleMeta}>{new Date(sale.createdAt).toLocaleString("fr-FR")}</Text>
              {items.map((line, index) => (
                <Text key={`${sale._id}-${index}`} style={styles.reportSaleLine}>
                  {index + 1}. {line.productName} | Qt: {line.quantity} | PU: {line.unitPrice} XOF
                </Text>
              ))}
              <Text style={styles.reportSaleTotal}>Total: {sale.totalPrice} XOF</Text>
            </View>
          );
        })}
      </View>
    );
  }

  function renderLineEditor(lines, updateFn, addFn, removeFn) {
    return lines.map((line, index) => {
      const lineTotal = Number(line.quantity || 0) * Number(line.unitPrice || 0);
      return (
        <View key={index} style={styles.lineCard}>
          <Text style={styles.lineTitle}>Produit {index + 1}</Text>

          <TextInput
            style={styles.input}
            placeholder="Nom du produit"
            value={line.productName}
            onChangeText={(value) => updateFn(index, "productName", value)}
          />
          <TextInput
            style={styles.input}
            placeholder="Quantite"
            keyboardType="numeric"
            value={line.quantity}
            onChangeText={(value) => updateFn(index, "quantity", value)}
          />
          <TextInput
            style={styles.input}
            placeholder="Prix unitaire"
            keyboardType="numeric"
            value={line.unitPrice}
            onChangeText={(value) => updateFn(index, "unitPrice", value)}
          />

          <Text style={styles.lineTotal}>Sous-total: {Number.isFinite(lineTotal) ? lineTotal : 0} XOF</Text>

          <TouchableOpacity
            style={[styles.miniDangerButton, lines.length === 1 && styles.disabledButton]}
            onPress={() => removeFn(index)}
            disabled={lines.length === 1}
          >
            <Text style={styles.miniDangerButtonText}>Retirer cette ligne</Text>
          </TouchableOpacity>
        </View>
      );
    });
  }

  function renderHome() {
    if (reportScreen === "daily") {
      return (
        <View style={styles.panel}>
          <TouchableOpacity style={styles.backLink} onPress={() => setReportScreen("menu")}>
            <Text style={styles.backLinkText}>{"<"} Retour Accueil</Text>
          </TouchableOpacity>
          <Text style={styles.panelTitle}>Rapport Journalier</Text>
          <Text style={styles.panelSubtitle}>Consultez le detail d'une date precise.</Text>
          <TextInput
            style={styles.input}
            placeholder="YYYY-MM-DD"
            value={reportDate}
            onChangeText={setReportDate}
          />
          <TouchableOpacity
            style={styles.miniButton}
            onPress={async () => {
              if (showDailyDetails) {
                setShowDailyDetails(false);
                return;
              }
              const ok = await loadDailyReport(reportDate);
              if (ok) {
                setShowDailyDetails(true);
              }
            }}
            disabled={loadingDailyReport}
          >
            {loadingDailyReport ? (
              <ActivityIndicator color="#0f172a" />
            ) : (
              <Text style={styles.miniButtonText}>{showDailyDetails ? "Reduire detail" : "Afficher detail"}</Text>
            )}
          </TouchableOpacity>
          {showDailyDetails && (
            <>
              <Text style={styles.reportText}>
                Ventes: {dailyReport?.salesCount ?? 0} | Total: {dailyReport?.totalAmount ?? 0} XOF
              </Text>
              <View style={styles.reportActions}>
                <TouchableOpacity
                  style={styles.miniButton}
                  onPress={() => previewReportPdf(`/api/sales/reports/daily/export.pdf?date=${encodeURIComponent(reportDate)}`)}
                >
                  <Text style={styles.miniButtonText}>Apercu PDF</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.reportPrimaryButton}
                  onPress={() =>
                    exportReportPdf(
                      `/api/sales/reports/daily/export.pdf?date=${encodeURIComponent(reportDate)}`,
                      `rapport-journalier-${reportDate || "date"}.pdf`,
                      "daily"
                    )
                  }
                  disabled={exportingReport === "daily"}
                >
                  {exportingReport === "daily" ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>Exporter et partager</Text>}
                </TouchableOpacity>
              </View>
              {renderReportDetails(dailyReport)}
            </>
          )}
        </View>
      );
    }

    if (reportScreen === "weekly") {
      return (
        <View style={styles.panel}>
          <TouchableOpacity style={styles.backLink} onPress={() => setReportScreen("menu")}>
            <Text style={styles.backLinkText}>{"<"} Retour Accueil</Text>
          </TouchableOpacity>
          <Text style={styles.panelTitle}>Rapport Hebdomadaire</Text>
          <Text style={styles.panelSubtitle}>Detail des ventes sur une semaine.</Text>
          <TextInput
            style={styles.input}
            placeholder="YYYY-MM-DD"
            value={weeklyDate}
            onChangeText={setWeeklyDate}
          />
          <TouchableOpacity
            style={styles.miniButton}
            onPress={async () => {
              if (showWeeklyDetails) {
                setShowWeeklyDetails(false);
                return;
              }
              const ok = await loadWeeklyReport(weeklyDate);
              if (ok) {
                setShowWeeklyDetails(true);
              }
            }}
            disabled={loadingWeeklyReport}
          >
            {loadingWeeklyReport ? (
              <ActivityIndicator color="#0f172a" />
            ) : (
              <Text style={styles.miniButtonText}>{showWeeklyDetails ? "Reduire detail" : "Afficher detail"}</Text>
            )}
          </TouchableOpacity>
          {showWeeklyDetails && (
            <>
              <Text style={styles.reportText}>
                Semaine: {weeklyReport?.from ?? "-"} au {weeklyReport?.to ?? "-"}
              </Text>
              <Text style={styles.reportText}>
                Ventes: {weeklyReport?.salesCount ?? 0} | Total: {weeklyReport?.totalAmount ?? 0} XOF
              </Text>
              <View style={styles.reportActions}>
                <TouchableOpacity
                  style={styles.miniButton}
                  onPress={() => previewReportPdf(`/api/sales/reports/weekly/export.pdf?date=${encodeURIComponent(weeklyDate)}`)}
                >
                  <Text style={styles.miniButtonText}>Apercu PDF</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.reportPrimaryButton}
                  onPress={() =>
                    exportReportPdf(
                      `/api/sales/reports/weekly/export.pdf?date=${encodeURIComponent(weeklyDate)}`,
                      `rapport-hebdomadaire-${weeklyDate || "date"}.pdf`,
                      "weekly"
                    )
                  }
                  disabled={exportingReport === "weekly"}
                >
                  {exportingReport === "weekly" ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>Exporter et partager</Text>}
                </TouchableOpacity>
              </View>
              {renderReportDetails(weeklyReport)}
            </>
          )}
        </View>
      );
    }

    if (reportScreen === "range") {
      return (
        <View style={styles.panel}>
          <TouchableOpacity style={styles.backLink} onPress={() => setReportScreen("menu")}>
            <Text style={styles.backLinkText}>{"<"} Retour Accueil</Text>
          </TouchableOpacity>
          <Text style={styles.panelTitle}>Rapport Intervalle</Text>
          <Text style={styles.panelSubtitle}>Detail entre deux dates.</Text>
          <TouchableOpacity style={styles.dateButton} onPress={() => openCalendar("from")}>
            <Text style={styles.dateButtonLabel}>Date debut</Text>
            <Text style={styles.dateButtonValue}>{rangeFrom || "Choisir une date"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dateButton} onPress={() => openCalendar("to")}>
            <Text style={styles.dateButtonLabel}>Date fin</Text>
            <Text style={styles.dateButtonValue}>{rangeTo || "Choisir une date"}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.miniButton}
            onPress={async () => {
              if (showRangeDetails) {
                setShowRangeDetails(false);
                return;
              }
              const ok = await loadRangeReport();
              if (ok) {
                setShowRangeDetails(true);
              }
            }}
            disabled={loadingRangeReport}
          >
            {loadingRangeReport ? (
              <ActivityIndicator color="#0f172a" />
            ) : (
              <Text style={styles.miniButtonText}>{showRangeDetails ? "Reduire detail" : "Afficher detail"}</Text>
            )}
          </TouchableOpacity>
          {showRangeDetails && (
            <>
              <Text style={styles.reportText}>
                Ventes: {rangeReport?.salesCount ?? 0} | Total: {rangeReport?.totalAmount ?? 0} XOF
              </Text>
              <View style={styles.reportActions}>
                <TouchableOpacity
                  style={styles.miniButton}
                  onPress={() =>
                    previewReportPdf(
                      `/api/sales/reports/range/export.pdf?from=${encodeURIComponent(rangeFrom)}&to=${encodeURIComponent(rangeTo)}`
                    )
                  }
                >
                  <Text style={styles.miniButtonText}>Apercu PDF</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.reportPrimaryButton}
                  onPress={() =>
                    exportReportPdf(
                      `/api/sales/reports/range/export.pdf?from=${encodeURIComponent(rangeFrom)}&to=${encodeURIComponent(rangeTo)}`,
                      `rapport-intervalle-${rangeFrom || "from"}-${rangeTo || "to"}.pdf`,
                      "range"
                    )
                  }
                  disabled={exportingReport === "range"}
                >
                  {exportingReport === "range" ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>Exporter et partager</Text>}
                </TouchableOpacity>
              </View>
              {renderReportDetails(rangeReport)}
            </>
          )}
        </View>
      );
    }

    return (
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Tableau de bord</Text>
        <Text style={styles.panelSubtitle}>Acces rapide aux rapports de ventes.</Text>

        <View style={styles.kpiGrid}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Nombre de ventes</Text>
            <Text style={styles.kpiValue}>{sales.length}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Montant total</Text>
            <Text style={styles.kpiValue}>{totalAmount} XOF</Text>
          </View>
        </View>

        <View style={styles.quickCardsRow}>
          <TouchableOpacity
            style={styles.quickCard}
            onPress={() => {
              setReportScreen("daily");
              setShowDailyDetails(false);
            }}
          >
            <Text style={styles.quickCardTitle}>Journalier</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickCard}
            onPress={() => {
              setReportScreen("weekly");
              setShowWeeklyDetails(false);
            }}
          >
            <Text style={styles.quickCardTitle}>Semaine</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickCard}
            onPress={() => {
              setReportScreen("range");
              setShowRangeDetails(false);
            }}
          >
            <Text style={styles.quickCardTitle}>Intervalle</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  function renderCreate() {
    return (
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Nouvelle vente</Text>
        <Text style={styles.panelSubtitle}>Ajoutez un ou plusieurs produits.</Text>

        {renderLineEditor(productLines, updateCreateLine, addCreateLine, removeCreateLine)}

        <TouchableOpacity style={styles.addLineButton} onPress={addCreateLine}>
          <Text style={styles.addLineButtonText}>+ Ajouter un produit</Text>
        </TouchableOpacity>

        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>Montant total de la vente</Text>
          <Text style={styles.totalValue}>{createTotal} XOF</Text>
        </View>

        <TouchableOpacity style={styles.primaryButton} onPress={handleCreateSale} disabled={loadingCreate}>
          {loadingCreate ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>Enregistrer la vente</Text>}
        </TouchableOpacity>
      </View>
    );
  }

  function renderHistory() {
    return (
      <View style={styles.panel}>
        <View style={styles.historyHeader}>
          <View>
            <Text style={styles.panelTitle}>Historique des ventes</Text>
            <Text style={styles.panelSubtitle}>Modification et suppression rapides.</Text>
          </View>
          <TouchableOpacity style={styles.refreshChip} onPress={loadSales}>
            <Text style={styles.refreshChipText}>Actualiser</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.filterCard}>
          <Text style={styles.reportTitle}>Filtre de recherche</Text>
          <TextInput
            style={styles.input}
            placeholder="Nom produit (ex: routeur)"
            value={searchText}
            onChangeText={setSearchText}
          />
          <TextInput
            style={styles.input}
            placeholder="Du (YYYY-MM-DD)"
            value={filterFrom}
            onChangeText={setFilterFrom}
          />
          <TextInput
            style={styles.input}
            placeholder="Au (YYYY-MM-DD)"
            value={filterTo}
            onChangeText={setFilterTo}
          />
          <View style={styles.inlineActions}>
            <TouchableOpacity style={styles.saveButton} onPress={applyHistoryFilters}>
              <Text style={styles.saveButtonText}>Appliquer</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={resetHistoryFilters}>
              <Text style={styles.cancelButtonText}>Reinitialiser</Text>
            </TouchableOpacity>
          </View>
        </View>

        {editingId ? (
          <View style={styles.editBox}>
            <Text style={styles.editTitle}>Modifier la vente</Text>

            {renderLineEditor(editLines, updateEditLine, addEditLine, removeEditLine)}

            <TouchableOpacity style={styles.addLineButton} onPress={addEditLine}>
              <Text style={styles.addLineButtonText}>+ Ajouter une ligne</Text>
            </TouchableOpacity>

            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>Nouveau montant total</Text>
              <Text style={styles.totalValue}>{editTotal} XOF</Text>
            </View>

            <View style={styles.inlineActions}>
              <TouchableOpacity style={styles.saveButton} onPress={saveEdit} disabled={savingEdit}>
                {savingEdit ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.saveButtonText}>Sauver</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelButton} onPress={cancelEdit}>
                <Text style={styles.cancelButtonText}>Annuler</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {loadingHistory ? (
          <ActivityIndicator color="#0f766e" style={styles.loader} />
        ) : sales.length === 0 ? (
          <Text style={styles.emptyText}>Aucune vente disponible.</Text>
        ) : (
          sales.map((item) => {
            const items = parseItemsFromSale(item);
            const ownerId = normalizeOwnerId(item?.createdBy);
            const canManage = Boolean(ownerId) && ownerId === currentUserId;
            return (
              <View key={item._id} style={styles.saleCard}>
                <Text style={styles.saleName}>Vente #{String(item._id).slice(-6)}</Text>
                {items.map((line, index) => (
                  <Text key={`${item._id}-${index}`} style={styles.saleLine}>
                    {index + 1}. {line.productName} | Qt: {line.quantity} | PU: {line.unitPrice} XOF
                  </Text>
                ))}
                <Text style={styles.saleTotal}>Total: {item.totalPrice} XOF</Text>

                <View style={styles.saleActions}>
                  {canManage ? (
                    <>
                      <TouchableOpacity style={styles.miniButton} onPress={() => startEdit(item)}>
                        <Text style={styles.miniButtonText}>Modifier</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.miniDangerButton} onPress={() => confirmDelete(item._id)}>
                        <Text style={styles.miniDangerButtonText}>Supprimer</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <View style={styles.readOnlyBadge}>
                      <Text style={styles.readOnlyBadgeText}>Lecture seule</Text>
                    </View>
                  )}
                  <TouchableOpacity
                    style={styles.miniButton}
                    onPress={() => openReceiptPreview(item._id)}
                    disabled={previewingId === item._id}
                  >
                    {previewingId === item._id ? <ActivityIndicator color="#0f172a" /> : <Text style={styles.miniButtonText}>Apercu</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.miniButton}
                    onPress={() => downloadAndShareReceipt(item._id, items[0]?.productName || "vente")}
                    disabled={downloadingId === item._id}
                  >
                    {downloadingId === item._id ? <ActivityIndicator color="#0f172a" /> : <Text style={styles.miniButtonText}>Envoyer</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </View>
    );
  }

  return (
    !authToken ? (
      <SafeAreaView style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.loginWrap}>
          <View style={styles.loginCard}>
            <Text style={styles.loginTitle}>Connexion</Text>
            <Text style={styles.loginSubtitle}>Entrez vos identifiants pour acceder a la gestion des ventes.</Text>
            <TextInput
              style={styles.input}
              placeholder="Email"
              autoCapitalize="none"
              keyboardType="email-address"
              value={loginEmail}
              onChangeText={setLoginEmail}
            />
            <TextInput
              style={styles.input}
              placeholder="Mot de passe"
              secureTextEntry
              value={loginPassword}
              onChangeText={setLoginPassword}
            />
            <TouchableOpacity style={styles.primaryButton} onPress={handleLogin} disabled={loggingIn}>
              {loggingIn ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>Se connecter</Text>}
            </TouchableOpacity>
            <Text style={styles.loginHint}>Compte par defaut: admin@sahelconnect.com / Admin@1234</Text>
          </View>
        </View>
      </SafeAreaView>
    ) : (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.headerBlock}>
        <Text style={styles.title}>Gestion de Vente</Text>
        <Text style={styles.subtitle}>
          {currentUser ? `${currentUser.fullName} (${currentUser.role})` : "Application de suivi commercial."}
        </Text>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutButtonText}>Deconnexion</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.contentWrap}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {tab === "home" && renderHome()}
          {tab === "create" && renderCreate()}
          {tab === "history" && renderHistory()}
        </ScrollView>
      </View>
      {renderCalendarModal()}

      <View style={styles.bottomNav}>
        <TouchableOpacity style={[styles.navItem, tab === "home" && styles.navItemActive]} onPress={() => setTab("home")}>
          <Text style={[styles.navText, tab === "home" && styles.navTextActive]}>Accueil</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.navItemCenter, tab === "create" && styles.navItemCenterActive]} onPress={() => setTab("create")}>
          <Text style={[styles.navCenterText, tab === "create" && styles.navCenterTextActive]}>+</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.navItem, tab === "history" && styles.navItemActive]} onPress={() => setTab("history")}>
          <Text style={[styles.navText, tab === "history" && styles.navTextActive]}>Historique</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
    )
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ecf1f7",
  },
  headerBlock: {
    paddingHorizontal: 18,
    paddingTop: Platform.OS === "android" ? 40 : 20,
    paddingBottom: 10,
  },
  loginWrap: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  loginCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#dbe5f0",
    backgroundColor: "#ffffff",
    padding: 14,
  },
  loginTitle: {
    color: "#0f172a",
    fontSize: 28,
    fontWeight: "900",
  },
  loginSubtitle: {
    color: "#64748b",
    marginTop: 4,
    marginBottom: 12,
  },
  loginHint: {
    marginTop: 10,
    color: "#64748b",
    fontSize: 12,
  },
  title: {
    fontSize: 40,
    lineHeight: 42,
    fontWeight: "900",
    color: "#0f172a",
    letterSpacing: -0.8,
  },
  subtitle: {
    marginTop: 2,
    color: "#475569",
    fontSize: 14,
    fontWeight: "500",
  },
  logoutButton: {
    marginTop: 8,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "#ffffff",
  },
  logoutButtonText: {
    color: "#334155",
    fontWeight: "700",
    fontSize: 12,
  },
  contentWrap: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 140,
  },
  panel: {
    borderRadius: 20,
    backgroundColor: "#ffffff",
    padding: 14,
    borderWidth: 1,
    borderColor: "#dbe5f0",
    shadowColor: "#0f172a",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  panelTitle: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "900",
    color: "#0f172a",
    letterSpacing: -0.4,
  },
  panelSubtitle: {
    color: "#64748b",
    fontSize: 13,
    marginTop: 3,
    marginBottom: 10,
  },
  backLink: {
    alignSelf: "flex-start",
    marginBottom: 8,
    paddingVertical: 4,
  },
  backLinkText: {
    color: "#0f766e",
    fontWeight: "800",
  },
  kpiGrid: {
    flexDirection: "row",
    gap: 8,
  },
  kpiCard: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: "#f8fbff",
    borderWidth: 1,
    borderColor: "#d6e4f2",
    padding: 10,
  },
  kpiLabel: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "600",
  },
  kpiValue: {
    color: "#0b1b34",
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "900",
    marginTop: 4,
  },
  reportCard: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#d6e4f2",
    padding: 10,
    backgroundColor: "#fbfdff",
  },
  quickCardsRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 8,
  },
  quickCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d6e4f2",
    backgroundColor: "#ffffff",
    paddingVertical: 12,
    alignItems: "center",
  },
  quickCardTitle: {
    color: "#334155",
    fontWeight: "800",
    fontSize: 12,
  },
  reportTitle: {
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 8,
  },
  reportText: {
    marginTop: 8,
    color: "#0f172a",
    fontWeight: "700",
  },
  reportActions: {
    marginTop: 10,
    flexDirection: "row",
    gap: 8,
  },
  reportPrimaryButton: {
    flex: 1,
    borderRadius: 9,
    backgroundColor: "#0f766e",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
  },
  reportDetailsWrap: {
    marginTop: 10,
    gap: 8,
  },
  reportSaleItem: {
    borderWidth: 1,
    borderColor: "#d6e4f2",
    borderRadius: 10,
    backgroundColor: "#fbfdff",
    padding: 9,
  },
  reportSaleTitle: {
    color: "#0f172a",
    fontWeight: "800",
  },
  reportSaleMeta: {
    color: "#475569",
    fontSize: 12,
    marginBottom: 4,
  },
  reportSaleLine: {
    color: "#334155",
    fontSize: 12,
    marginTop: 2,
  },
  reportSaleTotal: {
    marginTop: 6,
    color: "#0f172a",
    fontWeight: "800",
  },
  lineCard: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d6e4f2",
    backgroundColor: "#fbfdff",
    padding: 10,
  },
  lineTitle: {
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: "#d3deea",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: "#fdfefe",
    marginBottom: 8,
  },
  dateButton: {
    borderWidth: 1,
    borderColor: "#d3deea",
    borderRadius: 12,
    backgroundColor: "#fdfefe",
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  dateButtonLabel: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "700",
  },
  dateButtonValue: {
    color: "#0f172a",
    fontSize: 15,
    fontWeight: "800",
    marginTop: 2,
  },
  calendarOverlay: {
    flex: 1,
    backgroundColor: "rgba(2, 6, 23, 0.35)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  calendarCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 14,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#dbe5f0",
    padding: 12,
  },
  calendarHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  calendarNavBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#dbe5f0",
    alignItems: "center",
    justifyContent: "center",
  },
  calendarNavText: {
    fontWeight: "900",
    color: "#0f172a",
  },
  calendarTitle: {
    color: "#0f172a",
    fontWeight: "800",
    textTransform: "capitalize",
  },
  calendarWeekRow: {
    flexDirection: "row",
    marginBottom: 6,
  },
  calendarWeekLabel: {
    flex: 1,
    textAlign: "center",
    color: "#64748b",
    fontWeight: "700",
    fontSize: 12,
  },
  calendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  calendarDayCell: {
    width: "14.285%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  calendarDayCellSelected: {
    backgroundColor: "#0f766e",
  },
  calendarDayText: {
    color: "#0f172a",
    fontWeight: "700",
  },
  calendarDayTextSelected: {
    color: "#ffffff",
  },
  lineTotal: {
    color: "#0f172a",
    fontWeight: "700",
    marginBottom: 8,
  },
  addLineButton: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#0f766e",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#f0fdfa",
  },
  addLineButtonText: {
    color: "#0f766e",
    fontWeight: "800",
  },
  totalCard: {
    borderWidth: 1,
    borderColor: "#d6e4f2",
    borderRadius: 12,
    backgroundColor: "#f7fbff",
    padding: 10,
    marginTop: 10,
  },
  totalLabel: {
    color: "#475569",
    fontSize: 12,
    fontWeight: "700",
  },
  totalValue: {
    color: "#0f172a",
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "900",
    marginTop: 2,
  },
  primaryButton: {
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: "#0f766e",
    paddingVertical: 13,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "800",
  },
  historyHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  filterCard: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#d6e4f2",
    backgroundColor: "#f8fbff",
    padding: 10,
  },
  refreshChip: {
    borderRadius: 10,
    backgroundColor: "#d1fae5",
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  refreshChipText: {
    color: "#065f46",
    fontWeight: "800",
  },
  editBox: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#d5d9ff",
    borderRadius: 14,
    backgroundColor: "#f7f8ff",
    padding: 10,
  },
  editTitle: {
    color: "#3730a3",
    fontWeight: "900",
    marginBottom: 8,
  },
  inlineActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  saveButton: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: "#3730a3",
    alignItems: "center",
    paddingVertical: 11,
  },
  saveButtonText: {
    color: "#ffffff",
    fontWeight: "800",
  },
  cancelButton: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#3730a3",
    alignItems: "center",
    paddingVertical: 11,
    backgroundColor: "#ffffff",
  },
  cancelButtonText: {
    color: "#3730a3",
    fontWeight: "800",
  },
  loader: {
    marginTop: 14,
  },
  saleCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#d6e4f2",
    backgroundColor: "#fbfdff",
    padding: 11,
    marginTop: 10,
  },
  saleName: {
    color: "#0f172a",
    fontWeight: "900",
    fontSize: 16,
    marginBottom: 6,
  },
  saleLine: {
    color: "#334155",
    marginTop: 2,
  },
  saleTotal: {
    marginTop: 6,
    color: "#0f172a",
    fontWeight: "900",
  },
  saleActions: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
    marginTop: 10,
  },
  miniButton: {
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#0f172a",
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: "#ffffff",
  },
  miniButtonText: {
    color: "#0f172a",
    fontWeight: "800",
  },
  miniDangerButton: {
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#b91c1c",
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: "#fff5f5",
  },
  miniDangerButtonText: {
    color: "#b91c1c",
    fontWeight: "800",
  },
  readOnlyBadge: {
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: "#f8fafc",
  },
  readOnlyBadgeText: {
    color: "#475569",
    fontWeight: "800",
  },
  disabledButton: {
    opacity: 0.45,
  },
  emptyText: {
    marginTop: 12,
    color: "#64748b",
    fontWeight: "600",
  },
  bottomNav: {
    position: "absolute",
    left: 12,
    right: 12,
    borderWidth: 1,
    borderColor: "#dbe5f0",
    backgroundColor: "#ffffff",
    paddingVertical: 8,
    paddingHorizontal: 8,
    flexDirection: "row",
    gap: 8,
    bottom: Platform.OS === "android" ? 42 : 30,
    borderRadius: 18,
    shadowColor: "#0f172a",
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 5,
  },
  navItem: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#dbe5f0",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    backgroundColor: "#ffffff",
  },
  navItemActive: {
    borderColor: "#0f172a",
    backgroundColor: "#f2f6fb",
  },
  navText: {
    color: "#334155",
    fontWeight: "800",
  },
  navTextActive: {
    color: "#0f172a",
  },
  navItemCenter: {
    width: 74,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#dbe5f0",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
  navItemCenterActive: {
    backgroundColor: "#0f766e",
    borderColor: "#0f766e",
  },
  navCenterText: {
    fontSize: 26,
    lineHeight: 28,
    color: "#0f172a",
    fontWeight: "700",
  },
  navCenterTextActive: {
    color: "#ffffff",
  },
});
