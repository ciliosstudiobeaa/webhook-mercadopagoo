import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

// --- Função para formatar data DD/MM/YYYY ---
function formatarDataBR(val) {
  if (!val) return "";
  const d = new Date(val);
  if (isNaN(d)) return val;
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const ano = d.getFullYear();
  return `${dia}/${mes}/${ano}`;
}

// --- Função para formatar hora HH:mm ---
function formatarHora(val) {
  if (!val) return "";
  // Se vier fração de dia
  if (typeof val === "number") {
    const totalMin = Math.round(val * 24 * 60);
    const h = String(Math.floor(totalMin / 60)).padStart(2, "0");
    const m = String(totalMin % 60).padStart(2, "0");
    return `${h}:${m}`;
  }
  const d = new Date(val);
  if (!isNaN(d)) {
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }
  // se já estiver no formato HH:mm
  if (val.includes(":")) return val.split(":").slice(0, 2).join(":");
  return val;
}

// --- Rota horários bloqueados ---
app.get("/horarios-bloqueados", async (req, res) => {
  try {
    const response = await fetch(GOOGLE_SCRIPT_URL);
    const data = await response.json();

    // garante que dia/hora fiquem corretos
    const cleanData = data.map(x => ({
      Nome: x.Nome || x.nome || "",
      dia: formatarDataBR(x.dia || x.diaagendada || x.diaagendado),
      hora: formatarHora(x.hora || x.horaagendada),
      servico: x.servico || "",
      valor30: x.valor30 || 0,
      status: x.status || "",
      whatsapp: x.whatsapp || "",
      transaction_id: x.transaction_id || "",
      reference: x.reference || "",
    }));

    res.json(cleanData.filter(x => x.status === "Aprovado"));
  } catch (err) {
    console.error("Erro ao buscar horários:", err);
    res.status(500).json({ error: "Erro ao buscar horários" });
  }
});

// === Resto do backend permanece igual (gerar-pagamento, webhook, status-pagamento) ===
// Você pode copiar o código que já tinha para essas rotas.

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
