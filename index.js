import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import { google } from "googleapis";

const app = express();
app.use(bodyParser.json());

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

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
        range: "A2",
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
  } catch (e) {
    console.error(e);
    res.status(500).send("Erro interno");
  }
});

app.listen(process.env.PORT || 3000, () => console.log("🚀 Webhook rodando!"));
