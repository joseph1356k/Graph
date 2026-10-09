# Cifras y afirmaciones pendientes de revisión médica

Todas las guías del corpus tienen `revisado_por` vacío: **ninguna** ha sido revisada por un médico. Este archivo
lista, por guía, lo que los redactores marcaron como escrito de memoria o verificado solo con resúmenes
secundarios (los sitios de MinSalud, OMS, CDC, PMC y revistas no fueron alcanzables desde el entorno de
redacción). Prioridad de la revisión: lo marcado **Pendiente** primero.

Estados:
- **Corregido**: se verificó con al menos dos fuentes secundarias concordantes y se corrigió el texto.
- **Verificado (secundario)**: coincide con resúmenes secundarios; falta contrastar con la fuente primaria.
- **Retirado**: no se pudo verificar y se quitó la cifra del corpus.
- **Pendiente**: sigue en el texto; verificar en la fuente primaria antes de firmar la guía.

No es un archivo de guía: `build-guideline-corpus` solo compila los `.md` con cabecera de metadatos.

## crisis-hiperglucemicas-e-hipoglucemia
- **Corregido (2026-10-09):** potasio en CAD/EHH del consenso 2024: < 3,5 mmol/L diferir insulina y reponer 10–20 mmol/h; 3,5–5,0 mmol/L añadir 10–20 mmol por litro; > 5,0 mmol/L insulina sin potasio. El texto anterior decía 20–30 mmol/L (cifra de ADA 2009). Fuentes secundarias: guía de estudio BCEMP, presentación ABCD 2025.
- **Pendiente:** ISPAD 2022 «déficit en 24–48 h» y «40 mmol/L de potasio en los líquidos».

## paro-cardiorrespiratorio-rcp
- **Verificado (secundario):** control de temperatura 32–37,5 °C por al menos 36 h; SpO2 90–98 % (PaO2 60–105 mmHg).
- **Corregido (2026-10-09):** PaCO2 35–45 mmHg atribuida a ESICM 2021 (no confirmada en el texto AHA 2025); «no antes de 72 h» atribuido a AHA 2020 y ERC 2021 (AHA 2025 no lo confirma).

## tamizaje-de-cancer
- **Verificado (secundario):** mamografía bienal 50–69 años (Res. 276 de 2019 que modifica la 3280); examen clínico anual 40–49 años (lineamiento MinSalud).
- **Retirado (2026-10-09):** edades y periodicidad colombianas de FIT (50–75, cada 2 años) y de PSA con tacto rectal (50–75, cada 5 años): no se encontraron en fuentes consultables. El texto remite a la resolución vigente.
- **Pendiente:** citología 1-3-3 de 25 a 29 años, ADN-VPH cada 5 años de 30 a 65, VIA-VILI de 30 a 50 en zonas rurales dispersas; «ver y tratar» y repetir ADN-VPH a los 18 meses con citología de triaje negativa (GPC 2014).

## desnutricion-aguda-infantil
- **Pendiente:** cambios de la Resolución 115 de 2026 (egreso con puntaje Z ≥ −1, categoría «riesgo de desnutrición aguda», F-100 obligatorio, fórmula de inicio en menores de 6 meses); las fuentes secundarias no coinciden en el límite de la nueva categoría.
- **Pendiente:** código Sivigila «evento 113»; dosis del libro de bolsillo de la OMS (ampicilina más gentamicina, volúmenes de F-75, ReSoMal, líquidos en choque, transfusión).

## hemorragia-posparto
- **Pendiente:** fila «compensado» y pulso > 120 en la fila «severo» de la tabla de choque del código rojo.
- **Pendiente:** umbral OMS/FIGO/ICM 2025 (≥ 300 mL con signo hemodinámico anormal o ≥ 500 mL).

## anticoncepcion
- **Pendiente:** porcentajes de efectividad por método (CDC); categorías de la 6.ª edición de los criterios de elegibilidad de la OMS (2025).

## hemorragia-digestiva
- **Pendiente:** reiniciar aspirina en 3–5 días (ESGE); dosis de vasoactivos (AASLD 2016).

## anafilaxia
- **Pendiente:** niveles de observación del Resuscitation Council UK 2021 (2, 6 y 12 h).

## dolor-abdominal-agudo-apendicitis
- **Pendiente:** 3–5 días de antibiótico posoperatorio en apendicitis complicada (WSES).

## malaria
- **Pendiente:** esquema colombiano de cloroquina 10 / 7,5 / 7,5 mg/kg (guía 2010), mostrado junto al de la OMS.

## sifilis
- **Pendiente:** «si se pierde una dosis semanal en la gestante, reiniciar el esquema completo» (atribuido a CDC).

## infecciones-piel-tejidos-blandos
- **Pendiente:** vancomicina 30 mg/kg/día y piperacilina/tazobactam 3,375 g cada 6–8 h (tablas IDSA).

## consumo-de-alcohol
- **Pendiente:** dosis de ejemplo dirigidas por síntomas (diazepam 10–20 mg, lorazepam 2–4 mg); acamprosato 666 mg tres veces al día, naltrexona 50 mg, disulfiram 200 mg; umbral NICE «AUDIT > 15».

## dolor-cronico-y-opioides
- **Pendiente:** naloxona 0,4–2 mg (ficha técnica); reevaluar al menos cada 2 semanas en dolor agudo (CDC 2022).

## gota
- **Pendiente:** esquema EULAR de colchicina (1 mg y 0,5 mg una hora después) y prednisolona 30–35 mg por 3–5 días.

## osteoporosis
- **Pendiente:** edades de tamizaje y dosis de calcio de BHOF; criterios de muy alto riesgo de AACE.

## sincope
- **Pendiente:** 2–3 L de agua y 10 g de sal en hipotensión ortostática; reglas de conducción de la ESC (contrastar con la normativa colombiana).

## Guías de la primera tanda (33)
Redactadas sin acceso a las fuentes primarias. Todas requieren revisión médica completa antes de llenar
`revisado_por`; prioridad: dosis pediátricas (antibióticos, IRA, EDA, fiebre sin foco), embarazo (control
prenatal, preeclampsia) y urgencias (sepsis, ACV, TEP).
