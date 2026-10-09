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

## cirrosis-y-complicaciones
- **Nueva (2026-10-09):** redactada con búsqueda web; 26 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Lactulosa 25 mL por dosis (una fuente dice cada 2 h, no 1-2 h; otras fuentes dan 20-30 g o 30-45 mL); Rangos de INR en Child-Pugh (1,7-2,3 frente a 1,71-2,20 o 1,8-2,3 según la fuente); Equivalente en sal de 80-120 mmol de sodio (4,6 frente a 4,9-6,9 g); Umbral de sodio para suspender diuréticos (125 frente a 120 mmol/L); Cefotaxima 2 g cada 8 h y ceftriaxona 1 g frente a 2 g al día (solo de ensayos; dosis de la guía no confirmada); Duración de 5 días del antibiótico en PBE; Ciprofloxacino 500 mg/día como profilaxis; Criterios numéricos de la profilaxis primaria (Child-Pugh 9 o más con bilirrubina 3 mg/dL o más, creatinina 1,2 mg/dL o más, BUN 25 mg/dL o más, sodio 130 o menos); Dosis de terlipresina (1 mg cada 4-6 h según EASL frente a 0,85 mg cada 6 h en la ficha de EE. UU.); Albúmina junto al vasoconstrictor (20-40 g/día frente a 40-50 g/día); Albúmina en paracentesis menores de 5 L con PAS <90 mmHg o sodio <130 (una sola fuente); Proteínas 1,2-1,5 g/kg/día y energía 35-40 kcal/kg en encefalopatía (ISHEN; ESPEN/ASPEN dan 1,0-1,5); Espironolactona 100-200 mg de inicio en el primer episodio; Rifaximina desde 14 días antes de un TIPS electivo (una sola fuente); Recurrencia de PBE del 68 % al año sin profilaxis; Código de evento Sivigila de hepatitis B y C (omitido para no activar el escudo de privacidad).
- **Pendiente:** Se agotó el presupuesto de WebSearch (límite compartido de 200 búsquedas por turno), así que algunos puntos quedaron sin una segunda búsqueda. Casi todas las cifras salen de resúmenes secundarios, no del texto primario: hay que contrastarlas con AASLD 2021 (Hepatology 2021;74:1014) y con EASL 2018 (J Hepatol 2018;69:406)
- **Pendiente:** AASLD 2023 para CHC: confirmar si dice 'ecografía con AFP' o 'con o sin AFP'. MDCalc da la segunda forma, que podría ser de la versión 2018
- **Pendiente:** Norepinefrina como alternativa a terlipresina en SHR, y vacunar contra hepatitis A y B: son conductas sin cifra que no se verificaron con búsqueda por falta de presupuesto
- **Pendiente:** Intervalo de 72 h para ajustar diuréticos: verificado en una sola fuente secundaria
- **Pendiente:** Disponibilidad en Colombia (INVIMA/POS) de norfloxacino, rifaximina y terlipresina, y si hay protocolo nacional de MinSalud sobre cirrosis
- **Pendiente:** Hipernatremia o deshidratación por exceso de lactulosa en adultos mayores: es una precaución clínica sin fuente citada
- **Pendiente:** El umbral MELD de 15 o más viene de la guía AASLD/AST de 2013-2014; hay datos más recientes a favor de remitir antes
- **Pendiente:** Códigos CIE-10 de la OMS: K65.0 para PBE y K72.9 para encefalopatía (K76.82 solo existe en CIE-10-CM)

## hepatitis-b-y-c
- **Nueva (2026-10-09):** redactada con búsqueda web; 31 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Umbral de depuración por debajo del cual no se recomienda tenofovir alafenamida (<15 mL/min) y si debe tomarse con comida; Dosis de entecavir ajustadas a la depuración (0,25 mg al día o 0,5 mg cada 48 h): las encontré en una sola ficha y quedaron como 'ajustado a la depuración'; Recomendación específica de la OMS 2024 sobre inmunoglobulina al recién nacido: la OMS no la exige; se atribuyó a CDC y ETMI-Plus; Semana 28–32 para iniciar tenofovir según la revisión colombiana (fuente secundaria; se dejó el 'segundo trimestre' de OMS 2024); Umbral de 20 000 UI/mL de la versión ETMI-Plus 2018 (lo contradice la versión 2021-2030); Edades del ACIP para vacunar a todos los adultos (19–59 años) y esquemas de 0, 1 y 6 meses o de 2 dosis de Heplisav-B (no se escribieron para no confundir con el esquema del PAI); Recuadro de advertencia de la FDA sobre reactivación del VHB con AAD (se agotó el cupo de búsquedas antes de verificarlo); Grupos de tamizaje de la GPC colombiana de hepatitis C 2016/2018 (no se halló el texto); Recomendaciones de fármacos de la GPC colombiana de hepatitis B 2016 (solo se citó su existencia); Duración de la profilaxis antiviral en inmunosupresión (12 y 18 meses, AGA y EASL).
- **Pendiente:** Confirmar en el documento primario de la OMS 2024 los umbrales de APRI y elastografía, y la redacción de los criterios 'otros' (coinfecciones, comorbilidades), verificados solo con resúmenes secundarios
- **Pendiente:** Verificar que la Resolución 3280 de 2018 (anexo materno perinatal) incluye el HBsAg en el primer control; la búsqueda no lo confirmó y se apoyó en la guía de control prenatal del corpus
- **Pendiente:** Confirmar el código 340 del Sivigila en el protocolo vigente del INS (solo se halló en boletines territoriales)
- **Pendiente:** Confirmar que el ETMI-Plus 2021-2030 está vigente frente al Plan Nacional 2025-2031 y si este cambió umbrales o semana de inicio del tenofovir
- **Pendiente:** Contrastar con la ficha técnica INVIMA las dosis de TDF, entecavir y TAF y los ajustes renales (se usaron las fichas de FDA y europea)
- **Pendiente:** Tratamiento de hepatitis C durante el embarazo: la redacción de AASLD-IDSA ('individualizar') no se pudo leer textualmente
- **Pendiente:** Explicación de por qué las personas HBsAg positivas quedan fuera del esquema simplificado (riesgo de reactivación con AAD): falta verificar la advertencia de la FDA
- **Pendiente:** Interpretación del anti-HBc aislado: tomada de la tabla serológica de CDC sin una búsqueda específica
- **Pendiente:** Seguridad del tenofovir durante la lactancia: hay datos limitados y las fichas técnicas son más cautelosas que las guías

## hiponatremia-e-hiperpotasemia
- **Nueva (2026-10-09):** redactada con búsqueda web; 24 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Salbutamol nebulizado 10–20 mg (no verificado; se dejó 'dosis según protocolo'); Dosis de ciclosilicato de sodio y zirconio (10 g tres veces al día) y de patirómero (se remite a la ficha técnica); Duración de la vigilancia de glucemia tras insulina (6 h frente a 12 h): fuentes discordantes o no encontradas; Infusión de dextrosa al 10 % a 50 mL/h (solo se verificó '5 horas, 25 g'); Umbral de bicarbonato <22 mmol/L para usar bicarbonato de sodio; Umbral de potasio ≥6,0 mmol/L para indicar insulina con glucosa y para tomar ECG; Meta de +5 mmol/L en 24 h para los síntomas moderadamente graves (ESE); Ritmo de 1 mmol/L por hora si persisten los síntomas tras el primer aumento de 5 mmol/L; Sodio inicial ≤105 mmol/L como factor de riesgo de desmielinización (panel EE. UU. 2013); Bolo de salina al 3 % en niños (2 mL/kg); Intervalos para controlar el potasio tras el tratamiento (1, 2, 4, 6 y 24 h).
- **Pendiente:** Se agotó el presupuesto de búsquedas web de la sesión antes de terminar. Varias cifras solo tienen una fuente secundaria (no el texto primario de ESE 2014 ni de UKKA 2023): urea 0,25–0,50 g/kg, 0,5–1,0 mL/kg/h, 10 mL/kg de agua libre con desmopresina 2 µg cada 8 h, 150 mL en síntomas moderadamente graves e insulina 10 U con 25 g de glucosa
- **Pendiente:** La UKKA publicó en julio de 2026 una actualización de la guía de hiperpotasemia (calcio IV con evidencia rebajada tras ILCOR 2025; posibles cambios en salbutamol, quelantes y vigilancia de glucemia). Contrastar toda la sección de hiperpotasemia con esa versión vigente
- **Pendiente:** Velocidad de administración del calcio (10 minutos) tomada de la alerta MHRA 2023 y de la HSE; confirmar la redacción final de UKKA 2023/2026
- **Pendiente:** Afirmaciones cualitativas atribuidas a KDIGO 2020 (seudohiperpotasemia, mantener o reintroducir el bloqueo del sistema renina-angiotensina-aldosterona) sin verificación directa en el texto
- **Pendiente:** Diferencia ESE 2014 (no recomienda vaptanes) frente al panel de EE. UU. 2013 (los incluye); verificar la disponibilidad de urea y tolvaptán en Colombia
- **Pendiente:** No se encontró una guía de MinSalud ni de INS sobre estos trastornos; la conversión 7,0 mmol/L ≈ 126 mg/dL es aritmética, no tomada de una fuente
- **Pendiente:** Preparación de la salina al 3 % con las presentaciones colombianas: se dejó 'según el protocolo institucional'

## lesion-renal-aguda
- **Nueva (2026-10-09):** redactada con búsqueda web; 20 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Proteínas de KDIGO (0,8–1,0 / 1,0–1,5 / hasta 1,7 g/kg/día): ERBP no las respalda, otras fuentes dan cifras mayores y había que recortar palabras; Meta de glucemia de KDIGO 110–149 mg/dL: la contradice evidencia posterior; Resultados de STARRT-AKI sobre inicio temprano de la TRR: no se pudieron verificar, se agotó el presupuesto de búsquedas; Punto de corte de la FENa para azoemia prerrenal: no buscado; Plazo de suspensión de la metformina alrededor del contraste: no verificado; Edad ≥65 años como factor de riesgo de NICE en enfermedad aguda: no confirmada en la lista de recomendaciones; Límite exacto de ACR-NKF sobre si 45 queda dentro o fuera (≥45 o >45): ambiguo, el texto dice 'valores superiores'; Velocidad de infusión del gluconato de calcio (cambió en UKKA 2023): no verificada; K >6,5 y pH <7,2 como umbrales de diálisis: venían de un libro de texto, no de NICE; Orden completo de sitios de catéter de KDIGO (femoral, yugular izquierda, subclavia): una sola fuente secundaria, solo se dejó la yugular interna derecha.
- **Pendiente:** No se verificó si existe guía colombiana (MinSalud o Asocolnef) sobre LRA ni la notificación al Sivigila (p. ej. leptospirosis), porque se agotó el presupuesto de búsquedas; la mención de causas tropicales es cualitativa
- **Pendiente:** Confirmar en el texto vigente de NICE NG148 que el umbral <30 de la actualización 2024 aplica a todos los factores de riesgo de contraste; está confirmado para la rec. 1.2.9 (IECA/ARA II)
- **Pendiente:** La lista NICE para comentar con nefrología en 24 h solo se verificó en fuentes secundarias
- **Pendiente:** Contrastar las dosis de hiperpotasemia con la versión final de UKKA 2023 (se vio un PDF 'actualizado julio 2026'); el esquema de control de potasio a 1, 2, 4, 6 y 24 h tiene una sola fuente secundaria
- **Pendiente:** KDIGO 2012 sugería NAC; revisar si KDIGO publicó una actualización de la guía de LRA
- **Pendiente:** Volumen y páginas de las referencias en 'fuente' (Kidney Int Suppl 2012;2:1–138; Radiology 2020;294:660; Kidney Med 2020;2:85; NEJM 2018;378:603) escritos de memoria, sin verificar por búsqueda
- **Pendiente:** Hay otra guía en paralelo (hiponatremia-e-hiperpotasemia.md); conviene revisar que las dosis de potasio sean coherentes entre ambas
- **Pendiente:** En sinonimos.json la sigla 'ira' ya apunta a infección respiratoria aguda; no se propone para LRA para evitar la colisión
- **Pendiente:** Revisar los códigos CIE-10 elegidos (N14.1, N99.0, N13.9)

## meningitis-bacteriana
- **Nueva (2026-10-09):** redactada con búsqueda web; 25 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Umbrales del LCR (leucocitos mayores de 1 000/µL, relación de glucosa LCR/sangre menor de 0,4, proteínas mayores de X mg/dL): los puntos de corte publicados no coinciden (0,23; 0,36; 0,4); Plaquetas menores de 100 000/µL como contraindicación de la PL (solo en un resumen de una guía pediátrica antigua de NICE); Dosis prehospitalaria de bencilpenicilina 1,2 g / 600 mg / 300 mg por edad y de ceftriaxona prehospitalaria 80 mg/kg (no se pudo comprobar en el texto de NICE NG240; además, en Colombia la penicilina cristalina se dosifica en unidades); Frecuencia de ceftriaxona 80 mg/kg de NICE NG240 en niños (una o dos veces al día); Duraciones de NICE NG240 por germen (meningococo 5 días, neumococo 14 días, Hib 10 días); Dosis de vancomicina en adultos (15 a 20 mg/kg cada 8 a 12 h) y de ampicilina en niños (75 mg/kg cada 6 h); Antecedente de enfermedad del SNC como criterio IDSA de TAC previa (se acabó el cupo de búsquedas antes de comprobarlo); Esquema IDSA en inmunocomprometidos (vancomicina + ampicilina + cefepime o meropenem); Plazo de 24 h para la quimioprofilaxis según CDC (solo apareció en una fuente secundaria); Código del evento en Sivigila (535): está confirmado, pero se dejó fuera del texto para no arriesgar el escudo de privacidad.
- **Pendiente:** Se agotó el cupo de búsquedas web del turno (200) antes de terminar la verificación: los puntos siguientes quedaron con fuentes secundarias
- **Pendiente:** Texto literal de NICE NG240 (dosis de ceftriaxona, criterios de neuroimagen y si NICE fija una edad para el riesgo de Listeria): casi todo se verificó con resúmenes (GPnotebook, iatroX, formularios del NHS)
- **Pendiente:** Contraindicaciones de la PL atribuidas a 'recomendaciones pediátricas de NICE': vienen de un resumen de la guía antigua para niños (CG102), no de NG240
- **Pendiente:** Dosis de dexametasona de ESCMID 2016 (10 mg cada 6 h por 4 días en adultos; 0,15 mg/kg en niños): en el texto se atribuyen al ensayo de referencia y a guías británicas, no a ESCMID
- **Pendiente:** ESCMID 2016: añadir vancomicina o rifampicina donde hay neumococo con sensibilidad reducida (confirmado solo con un resumen secundario)
- **Pendiente:** Suspender la dexametasona en Listeria: viene de cohortes observacionales y de Bugs & Drugs; ESCMID y NICE no lo confirmaron directamente
- **Pendiente:** Quimioprofilaxis en gestantes con ceftriaxona: se deduce de que rifampicina y ciprofloxacino se evitan; contrastar con el lineamiento de MinSalud (tabla de contactos y dosis)
- **Pendiente:** Lineamiento de MinSalud de rifampicina antes del egreso para eliminar el estado de portador: viene de un documento antiguo; comprobar si sigue vigente y si se omite cuando el paciente recibió ceftriaxona
- **Pendiente:** Protocolo INS 2024 (evento 535): modalidades de notificación (súper inmediata, inmediata, semanal) por agente y definición de caso vigente; el texto usa la definición de la Circular 033 de 2016
- **Pendiente:** Comprobar si en Colombia se recomienda vancomicina empírica de rutina según la resistencia local del neumococo

## pancreatitis-y-colecistitis
- **Nueva (2026-10-09):** redactada con búsqueda web; 24 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Umbral de dopamina para la disfunción cardiovascular en TG18 (fuentes con ≥5 y con >5 µg/kg/min) y fármaco (noradrenalina frente a epinefrina): quedó como 'hipotensión que requiere vasopresores'; Hipoalbuminemia en colangitis grado II: menor de 0,7 veces el límite inferior normal frente a menor de 25 g/L (fuentes discrepantes); Suspender el antibiótico dentro de las 24 h tras la colecistectomía en colecistitis grados I y II (TG18): no verificado; Hematocrito mayor de 44 % (otra fuente dice 40 %) y BUN de 20 mg/dL o más como predictores de gravedad; Edad mayor de 55 años e IMC mayor de 30 como factores de riesgo de pancreatitis grave; Enzimas normales en cerca del 5 % de los pacientes al ingreso; CPRE en las primeras 24 h con colangitis según ACG 2024 (solo verificada para ACG 2013); Antibióticos concretos por grado en TG18 (cefazolina, ceftriaxona, metronidazol, piperacilina/tazobactam) y umbral de sensibilidad local del 80 % para ampicilina/sulbactam; Plazo de la colecistectomía temprana en colecistitis (72 h desde el inicio o 7 días desde el ingreso); Plazo de la colecistectomía en pancreatitis biliar necrosante (diferirla 6 semanas); Alcohol como causa en el 25 a 35 % de los casos; Criterios pediátricos de pancreatitis (INSPPIRE) y volúmenes de líquidos en niños; Seguridad de la colecistectomía laparoscópica en cualquier trimestre de la gestación; Definición de los factores predictivos negativos de TG18 (bilirrubina de 2 mg/dL o más, disfunción neurológica o respiratoria); Si la pancreatitis o la colecistitis son eventos de notificación en Sivigila: no verificado.
- **Pendiente:** El cupo de búsquedas web del turno se agotó antes de terminar: varios datos quedaron sin una segunda fuente y conviene completarlos en una sesión posterior
- **Pendiente:** Confirmar en el texto completo de ACG 2024 el esquema de 1,5 mL/kg/h con bolos de 10 mL/kg: se verificó en el ensayo WATERFALL y en resúmenes de la guía, no en su texto
- **Pendiente:** Confirmar si ACG 2024 mantiene la CPRE en las primeras 24 h con colangitis concomitante (la guía cita la versión 2013)
- **Pendiente:** Contrastar en la tabla original de TG18 los umbrales diagnósticos de colangitis (partes A y B), el umbral de fiebre del grado II (≥39 °C) y la definición de hipoalbuminemia
- **Pendiente:** Revisar en el flujograma de TG18 qué es 'falla orgánica favorable' y cuáles son los 'factores predictivos negativos' del grado III
- **Pendiente:** Revisar la duración de los antibióticos en la colecistitis según el capítulo antimicrobiano de TG18 y los antibióticos empíricos recomendados por grado
- **Pendiente:** La afirmación de ACG 2024 sobre neoplasia en mayores de 40 años sin causa viene de una sola fuente secundaria
- **Pendiente:** La analgesia según WSES 2019 se tomó de un resumen secundario; confirmar la redacción
- **Pendiente:** No se verificaron recomendaciones específicas para gestantes ni para niños; el texto es genérico y conservador
- **Pendiente:** No se revisó el contenido de la guía colombiana de 2010 ni del estándar de la Universidad Nacional de 2025
- **Pendiente:** CIE-10: se usaron las subcategorías K85.0 a K85.9; verificar si RIPS en Colombia usa K85X

## Guías de la primera tanda (33)
Redactadas sin acceso a las fuentes primarias. Todas requieren revisión médica completa antes de llenar
`revisado_por`; prioridad: dosis pediátricas (antibióticos, IRA, EDA, fiebre sin foco), embarazo (control
prenatal, preeclampsia) y urgencias (sepsis, ACV, TEP).
