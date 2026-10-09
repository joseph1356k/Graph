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
- **Verificado (secundario, 2026-10-09):** Resolución 115 del 27 de enero de 2026 (modifica parcialmente la 2350): atención al riesgo de desnutrición aguda con puntaje Z > −2 y < −1 DE; F-100 obligatorio en el tratamiento intrahospitalario y ambulatorio y disponibilidad de F-75, F-100 y FTLC por las EPS; el egreso con Z ≥ −2 se considera insuficiente (recuperación con Z ≥ −1 según fuente secundaria). Sivigila «evento 113» confirmado (protocolo actualizado en 2023; Circular 028 de 2025).
- **Retirado (2026-10-09):** «la Res. 115 ordena garantizar fórmula de inicio a menores de 6 meses»: no se encontró en las fuentes consultadas.
- **Pendiente:** confirmar el umbral exacto de egreso en el anexo técnico de la Res. 115; dosis del libro de bolsillo de la OMS 2013 (F-75 130 mL/kg/día, ampicilina 50 mg/kg cada 6 h más gentamicina 7,5 mg/kg/día, ReSoMal 5 mL/kg cada 30 min por 2 h, choque 15 mL/kg en 1 h, transfusión 10 mL/kg en 3 h): coinciden con el conocimiento del revisor del loop, falta contraste con la fuente primaria.

## hemorragia-posparto
- **Verificado (secundario, 2026-10-09):** tabla de choque del Código Rojo (Rev Colomb Obstet Ginecol 2009): leve 16–25 %, pulso 91–100, sistólica 80–90; moderado 26–35 %, pulso 101–120, sistólica 70–79 (corregido: decía 70–80); severo > 35 %, pulso > 120, sistólica < 70. Umbral OMS/FIGO/ICM del 5 de octubre de 2025: actuar desde 300 mL con signos vitales anormales o desde 500 mL.
- **Retirado (2026-10-09):** cifras de la fila «compensado» (500–1 000 mL, 10–15 %) y los cortes de signos vitales anormales de la guía 2025 (pulso > 100, índice de choque > 1, sistólica < 100, diastólica < 60): no confirmados en las fuentes consultadas.

## anticoncepcion
- **Pendiente:** porcentajes de efectividad por método (CDC); categorías de la 6.ª edición de los criterios de elegibilidad de la OMS (2025).

## hemorragia-digestiva
- **Verificado (secundario, 2026-10-09):** ESGE 2021: no suspender la aspirina de prevención secundaria y, si se suspendió, reanudarla lo antes posible, idealmente en 3–5 días (la frase «hacia el día 3» es de la ESGE 2015). Vasoactivos: terlipresina 2 mg IV cada 4 h por 48 h y luego 1 mg cada 4 h (dos revisiones concordantes); octreotide 50 µg en bolo y 50 µg/h, y somatostatina 250 µg en bolo y 250–500 µg/h (una tabla de revisión; otra revisión usa somatostatina 500 µg y 500 µg/h).
- **Pendiente:** contrastar las dosis con la tabla de la guía AASLD 2016 (Hepatology 2017).

## anafilaxia
- **Verificado (secundario, 2026-10-09):** observación escalonada del Resuscitation Council UK 2021 (2 h con una dosis y buena respuesta, dos autoinyectores y acompañamiento; mínimo 6 h con dos dosis o reacción bifásica previa; mínimo 12 h en reacción grave con más de dos dosis, asma grave, absorción continua, consulta nocturna o acceso difícil a urgencias), adoptada por NICE NG258.
- **Corregido (2026-10-09):** NICE NG258 (27 de mayo de 2026) reemplazó a CG134; se retiró la frase «observar a los mayores de 16 años 6 a 12 horas» de CG134 y los menores de 16 se hospitalizan solo si no cumplen los criterios de alta.

## dolor-abdominal-agudo-apendicitis
- **Pendiente:** 3–5 días de antibiótico posoperatorio en apendicitis complicada (WSES).

## malaria
- **Verificado (secundario, 2026-10-09):** cloroquina 25 mg base/kg en 3 días repartida 10 / 7,5 / 7,5 mg/kg (estudio colombiano que cita la guía 2010; un ensayo de Antioquia usa 600 / 450 / 450 mg en adultos, proporción equivalente).
- **Pendiente:** confirmar en la GPC 67-2022 si conserva el reparto 10 / 7,5 / 7,5.

## sifilis
- **Corregido (2026-10-09):** la regla de la CDC 2021 no es «si se pierde una dosis»: el intervalo óptimo es de 7 días y, en la gestante, más de 9 días entre dosis obliga a repetir el esquema completo (página de sífilis latente de la CDC y resumen del departamento de salud de Maine). Algunas guías estatales recientes (California 2025) son más estrictas: reiniciar ante cualquier dosis tardía.

## infecciones-piel-tejidos-blandos
- **Pendiente:** vancomicina 30 mg/kg/día y piperacilina/tazobactam 3,375 g cada 6–8 h (tablas IDSA).

## consumo-de-alcohol
- **Pendiente:** dosis de ejemplo dirigidas por síntomas (diazepam 10–20 mg, lorazepam 2–4 mg); acamprosato 666 mg tres veces al día, naltrexona 50 mg, disulfiram 200 mg; umbral NICE «AUDIT > 15».

## dolor-cronico-y-opioides
- **Pendiente:** naloxona 0,4–2 mg (ficha técnica); reevaluar al menos cada 2 semanas en dolor agudo (CDC 2022).

## gota
- **Verificado (secundario, 2026-10-09):** EULAR 2016: colchicina en las primeras 12 h con 1 mg y 0,5 mg el primer día; prednisolona equivalente 30–35 mg al día por 3–5 días (resumen de la guía en prensa médica; la dosis de prednisolona coincide con resúmenes británicos y con el ensayo de Janssens 2008 con 35 mg).
- **Pendiente:** el intervalo de «una hora» entre la dosis de 1 mg y la de 0,5 mg está en otras fuentes (ensayo AGREE), no en el resumen EULAR consultado.

## osteoporosis
- **Pendiente:** edades de tamizaje y dosis de calcio de BHOF; criterios de muy alto riesgo de AACE.

## sincope
- **Pendiente:** 2–3 L de agua y 10 g de sal en hipotensión ortostática; reglas de conducción de la ESC (contrastar con la normativa colombiana).

## Guías de la primera tanda (33)
Redactadas sin acceso a las fuentes primarias. Todas requieren revisión médica completa antes de llenar
`revisado_por`; prioridad: dosis pediátricas (antibióticos, IRA, EDA, fiebre sin foco), embarazo (control
prenatal, preeclampsia) y urgencias (sepsis, ACV, TEP).
