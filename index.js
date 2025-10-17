import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

// === VARIÁVEIS DE AMBIENTE ===
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

// === ROTA PARA HORÁRIOS BLOQUEADOS ===
app.get("/horarios-bloqueados", async (req, res) => {
  try {
    const response = await fetch(GOOGLE_SCRIPT_URL);
    const data = await response.json(); // retorna [{diaagendado, horaagendada, status}]
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
    // Garante que o preço seja número
    const precoLimpo = parseFloat(
      String(precoTotal).replace(/[^\d.,]/g, "").replace(",", ".")
    );

    // Gerar pagamento no Mercado Pago
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
        external_reference: JSON.stringify({
          nome,
          whatsapp,
          servico,
          precoTotal: precoLimpo,
          diaagendado,
          horaagendada,
        }),
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
    console.log("Recebido webhook MP:", JSON.stringify(req.body));

    const { type, data } = req.body;

    if (type !== "payment" || !data?.id) {
      return res.status(400).json({ ok: false, msg: "Evento inválido" });
    }

    const mpResp = await fetch(`https://api.mercadopago.com/v1/payments/${data.id}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });

    const mpData = await mpResp.json();
    console.log("Pagamento recebido do MP:", mpData);

    if (mpData.status !== "approved") {
      console.log("Pagamento não aprovado, ignorando.");
      return res.json({ ok: true });
    }

    const externalRef = JSON.parse(mpData.external_reference || "{}");
    const { nome, whatsapp, diaagendado, horaagendada, servico } = externalRef;
    let { precoTotal } = externalRef;

    precoTotal = parseFloat(String(precoTotal).replace(/[^\d.,]/g, "").replace(",", "."));
    const transaction_id = mpData.transaction_details?.transaction_id || mpData.id || "";
    const reference = mpData.external_reference || "";

    // Corrige data para formato BR
    function formatarDataBR(dataISO) {
      if (!dataISO) return "";
      const partes = dataISO.split("-");
      if (partes.length !== 3) return dataISO;
      return `${partes[2]}/${partes[1]}/${partes[0]}`;
    }
    const diaagendadoFormatado = formatarDataBR(diaagendado);

    // Envia pro Google Script (com nome da coluna exato)
    const scriptResponse = await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome,
        whatsapp,
        servico,
        "valor 30%": precoTotal,
        diaagendado: diaagendadoFormatado,
        horaagendada,
        status: "Aprovado",
        transaction_id,
        reference,
      }),
    });

    const scriptData = await scriptResponse.text();
    console.log("Resposta Google Script:", scriptResponse.status, scriptData);

    res.json({ ok: true });
  } catch (err) {
    console.error("Erro no webhook:", err);
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// === START SERVER ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
