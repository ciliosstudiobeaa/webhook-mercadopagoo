import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import { google } from "googleapis";
import cors from "cors";

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const SHEET_NAME = "Agendamentos";

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

app.get("/", (_, res) => res.send("✅ Webhook ativo!"));

app.post("/create_preference", async (req, res) => {
  try {
    const { nome, telefone, servico, precoTotal, data, hora } = req.body;

    if (!nome || !telefone || !servico || !precoTotal) {
      return res.status(400).json({ error: "Campos obrigatórios faltando" });
    }

    const payload = {
      items: [{ title: servico, quantity: 1, unit_price: Number(precoTotal) }],
      external_reference: JSON.stringify({ nome, telefone, servico, preco: precoTotal, data, hora }),
      back_urls: { success: "https://seusite.com/sucesso", failure: "https://seusite.com/falha" },
      auto_return: "approved"
    };

    const { data } = await axios.post("https://api.mercadopago.com/checkout/preferences", payload, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
    });

    res.json({ init_point: data.init_point });
  } catch (err) {
    console.error("Erro create_preference:", err.message);
    res.status(500).json({ error: "Erro ao criar preferência" });
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const paymentId = req.body?.data?.id || req.query?.id;
    if (!paymentId) return res.status(200).send("OK");

    const { data } = await axios.get(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      { headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` } }
    );

    if (data.status === "approved") {
      const ref = JSON.parse(data.external_reference || "{}");
      const sheets = await getSheets();
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2`,
        valueInputOption: "RAW",
        requestBody: {
          values: [[
            ref.nome || "", ref.telefone || "", ref.servico || "",
            ref.preco || "", ref.data || "", ref.hora || "",
            data.status, data.id, new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
          ]]
        }
      });
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("Erro no webhook:", err.message);
    res.status(500).send("Erro interno");
  }
});

app.listen(PORT, () => console.log(`🚀 Webhook rodando na porta ${PORT}`));
