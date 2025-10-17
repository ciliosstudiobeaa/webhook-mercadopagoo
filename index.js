import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

// === VARIÁVEIS DE AMBIENTE ===
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

// === FUNÇÃO PARA LIMPAR E CONVERTER VALOR EM NÚMERO ===
function limparValor(valor) {
  if (!valor) return 0;
  // Remove tudo que não seja número ou vírgula/ponto
  let num = String(valor).replace(/[^\d.,]/g, "");
  // Substitui vírgula por ponto
  num = num.replace(",", ".");
  const parsed = parseFloat(num);
  return isNaN(parsed) ? 0 : parsed;
}

// === FUNÇÃO PARA FORMATAR DATA BR ===
function formatarDataBR(dataISO) {
  if (!dataISO) return "";
  const partes = dataISO.split("-");
  if (partes.length !== 3) return dataISO;
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

// === ROTA PARA HORÁRIOS BLOQUEADOS ===
app.get("/horarios-bloqueados", async (req, res) => {
  try {
    const response = await fetch(GOOGLE_SCRIPT_URL);
    const data = await response.json();
    const approved = data.filter(x => x.status === "Aprovado");
    res.json(approved);
  } catch (e) {
    console.error("Erro ao buscar horários:", e);
    res.status(500).json({ error: "Erro ao buscar horários" });
  }
});

// === ROTA PARA GERAR PAGAMENTO ===
app.post("/gerar-pagamento", async (req, res) => {
  const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;

  if (!nome || !whatsapp || !servico || !precoTotal || !diaagendado || !horaagendada) {
    return res.status(400).json({ error: "Campos obrigatórios faltando" });
  }

  try {
    const precoLimpo = limparValor(precoTotal);

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        items: [
          {
            title: servico,
            quantity: 1,
            unit_price: precoLimpo,
          },
        ],
        back_urls: {
          success: "https://seusite.com/sucesso",
          pending: "",
          failure: "",
        },
        auto_return: "approved",
        external_reference: JSON.stringify({ nome, whatsapp, servico, precoTotal: precoLimpo, diaagendado, horaagendada }),
      }),
    });

    const mpJson = await mpRes.json();
    if (!mpJson.init_point) return res.status(500).json({ error: "Erro ao gerar pagamento MP", mpJson });

    res.json({ init_point: mpJson.init_point });
  } catch (e) {
    console.error("Erro ao gerar pagamento:", e);
    res.status(500).json({ error: "Erro interno" });
  }
});

// === ROTA DE WEBHOOK PARA PAGAMENTO APROVADO ===
app.post("/webhook", async (req, res) => {
  try {
    const { type, data } = req.body;

    if (type === "payment") {
      const paymentId = data.id;

      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
      });
      const mpData = await mpRes.json();

      if (mpData.status === "approved") {
        let externalRef = {};
        try { externalRef = JSON.parse(mpData.external_reference); } catch {}

        const nome = externalRef.nome || "";
        const whatsapp = externalRef.whatsapp || "";
        const servico = externalRef.servico || mpData.description || "";
        const diaagendado = formatarDataBR(externalRef.diaagendado || "");
        const horaagendada = externalRef.horaagendada || "";
        const status = "Aprovado";

        // valor limpo
        const valor30 = limparValor(mpData.transaction_amount || externalRef.precoTotal);

        // transaction_id e reference
        const transaction_id = mpData.transaction_details?.transaction_id || "";
        const reference = paymentId || "";

        await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nome,
            whatsapp,
            servico,
            diaagendado,
            horaagendada,
            status,
            "Valor 30%": valor30,
            transaction_id,
            reference,
          }),
        });
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Erro webhook MP:", err);
    res.sendStatus(500);
  }
});

// === START SERVER ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
