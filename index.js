import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// Webhook Mercado Pago
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;
    console.log("📩 Webhook recebido:", JSON.stringify(body, null, 2));

    if (body.action === "payment.created" || body.action === "payment.updated") {
      const paymentId = body.data.id;

      // Consulta pagamento no Mercado Pago
      const resp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${process.env.ACCESS_TOKEN}` },
      });
      const pagamento = await resp.json();

      if (pagamento.status === "approved") {
        const metadata = pagamento.metadata || {};

        // Envia para a planilha Google Sheets
        await fetch("https://script.google.com/macros/s/AKfycbxKtox0VU2EMvKzZdRLCVAr-zSMuGK-8THdqlE9vh3oj4BqQfmgNlNFYV99HGMItN07/exec", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nome: metadata.nome || pagamento.payer?.first_name || "Cliente",
            diaagendado: metadata.diaagendado || "",
            horaagendada: metadata.horaagendada || "",
            servico: metadata.servico || pagamento.description || "",
            valor: pagamento.transaction_amount,
            status: "Aprovado",
            whatsapp: metadata.whatsapp || "",
          }),
        });
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Erro no webhook:", err);
    res.sendStatus(500);
  }
});

// Porta dinâmica do Render
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Webhook ativo na porta ${PORT}`));
