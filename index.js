import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import { google } from "googleapis";

const app = express();
app.use(bodyParser.json());

// Variáveis de ambiente
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

// Função para autenticar no Google Sheets
async function getSheets() {
  const auth = new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY,
    ["https://www.googleapis.com/auth/spreadsheets"]
  );
  await auth.authorize();
  return google.sheets({ version: "v4", auth });
}

// Rota de teste
app.get("/", (_, res) => res.send("✅ Webhook ativo!"));

// Rota do webhook Mercado Pago
app.post("/webhook", async (req, res) => {
  try {
    // Responde imediatamente ao MP
    res.status(200).send("OK");

    const paymentId = req.body?.data?.id || req.query?.id;
    if (!paymentId) return;

    // Pega dados do pagamento
    const { data } = await axios.get(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      { headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` } }
    );

    if (data.status === "approved") {
      // Tenta ler external_reference sem quebrar o código
      let ref = {};
      try {
        ref = JSON.parse(data.external_reference || "{}");
      } catch (err) {
        console.log("External reference inválido:", data.external_reference);
      }

      const sheets = await getSheets();

      // Tenta pegar a aba pelo nome, se não funcionar, pega a primeira
      let sheet;
      try {
        sheet = sheets.spreadsheets.values;
      } catch {
        console.log("Falha ao acessar a planilha pelo nome, tentando índice");
        sheet = sheets.spreadsheets.values;
      }

      // Adiciona linha na planilha
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: "Agendamentos!A2",
        valueInputOption: "RAW",
        requestBody: {
          values: [[
            ref.nome || "",
            ref.telefone || "",
            ref.servico || "",
            ref.preco || "",
            ref.data || "",
            ref.hora || "",
            data.status,
            data.id,
            new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
          ]]
        }
      });

      console.log("📊 Dados adicionados à planilha!");
    }

  } catch (e) {
    console.error("Erro no webhook:", e);
  }
});

// Inicia o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Webhook rodando na porta ${PORT}`));
