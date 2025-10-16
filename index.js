import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

// Rota para gerar pagamento
app.post("/gerar-pagamento", async (req, res) => {
  try {
    const data = req.body;

    // envio para o Google Script
    const gsRes = await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, status: "Aprovado" })
    });
    const gsJson = await gsRes.json();

    if (!gsJson.ok) throw new Error(gsJson.msg);

    // aqui você chamaria Mercado Pago para gerar checkout
    // simulação de retorno
    return res.json({ init_point: "https://www.mercadopago.com.br/checkout/v1/redirect" });

  } catch (err) {
    console.error(err);
    res.json({ error: err.message });
  }
});

// Rota para buscar horários bloqueados
app.get("/horarios-bloqueados", async (req, res) => {
  try {
    const gsRes = await fetch(GOOGLE_SCRIPT_URL, { method: "GET" });
    const data = await gsRes.json();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.json({ error: err.message });
  }
});

app.listen(3000, () => console.log("Servidor rodando na porta 3000"));
