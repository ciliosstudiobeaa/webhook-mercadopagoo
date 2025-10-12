import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import axios from "axios";
import { google } from "googleapis";

const app = express();
app.use(cors());
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

// Rota de teste
app.get("/", (_, res) => res.send("✅ Webhook ativo!"));

// Criar preferência de pagamento
app.post("/create_preference", async (req, res) => {
  try {
    const { nome, telefone, servico, precoTotal, data, hora } = req.body;
    if (!nome || !telefone || !servico || !precoTotal || !data || !hora) {
      return res.status(400).json({ error: "Campos obrigatórios faltando" });
    }

    const preference = {
      items: [
        { title: servico, quantity: 1, unit_price: parseFloat(precoTotal) }
      ],
      external_reference: JSON.stringify({ nome, telefone, servico, preco: precoTotal, data, hora }),
      back_urls: { success: "https://seu-site.netlify.app", failure: "https://seu-site.netlify.app" },
      auto_return: "approved"
    };

    const { data } = await axios.post(
      "https://api.mercadopago.com/checkout/preferences",
      preference,
      { headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` } }
    );

    res.json({ init_point: data.init_point });
  } catch (err) {
    console.error("Erro ao criar preferência:", err.response?.data || err.message);
    res.status(500).json({ error: "Erro ao criar preferência" });
  }
});

// Webhook do Mercado Pago
app.post("/webhook", async (req, res) => {
  try {
    const paymentId = req.body?.data?.id || req.query?.id;
    if (!paymentId) return res.status(200).send("OK");

    let paymentData;
    try {
      const response = await axios.get(
        `https://api.mercadopago.com/v1/payments/${paymentId}`,
        { headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` } }
      );
      paymentData = response.data;
    } catch (err) {
      if (err.response?.status === 404) {
        console.log("⚠️ Pagamento não encontrado (sandbox ou teste)");
        return res.status(200).send("OK");
      } else {
        throw err;
      }
    }

    if (paymentData.status === "approved") {
      let ref = {};
      try { ref = JSON.parse(paymentData.external_reference || "{}"); } catch {}
      const sheets = await getSheets();
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: "Agendamentos!A2:Z",
        valueInputOption: "RAW",
        requestBody: {
          values: [[
            ref.nome || "",
            ref.telefone || "",
            ref.servico || "",
            ref.preco || "",
            ref.data || "",
            ref.hora || "",
            paymentData.status,
            paymentData.id,
            new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
          ]]
        }
      });

      console.log(`✅ Pagamento aprovado e registrado: ${paymentData.id}`);
    }

    res.status(200).send("OK");
  } catch (e) {
    console.error("Erro no webhook:", e.message);
    res.status(500).send("Erro interno");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Webhook rodando na porta ${PORT}`));
