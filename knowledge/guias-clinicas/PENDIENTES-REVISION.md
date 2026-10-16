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
- **Verificado (secundario, 2026-10-09):** potasio de 40 mmol/L en los líquidos una vez documentada la diuresis (recurso docente basado en ISPAD; ISPAD 2022 pide vía central por encima de 40 mmol/L) y cálculo de líquidos para las primeras 48 h.
- **Verificado (secundario, 2026-10-09):** reponer el déficit restante más el mantenimiento de forma gradual en 24–48 h (guía de estudio que lo atribuye a ISPAD 2022 y tabla de revisión de 2020 concordantes). El texto primario de ISPAD 2022 no se pudo leer: contrastarlo.

## paro-cardiorrespiratorio-rcp
- **Verificado (secundario):** control de temperatura 32–37,5 °C por al menos 36 h; SpO2 90–98 % (PaO2 60–105 mmHg).
- **Corregido (2026-10-09):** PaCO2 35–45 mmHg atribuida a ESICM 2021 (no confirmada en el texto AHA 2025); «no antes de 72 h» atribuido a AHA 2020 y ERC 2021 (AHA 2025 no lo confirma).

## tamizaje-de-cancer
- **Verificado (secundario):** mamografía bienal 50–69 años (Res. 276 de 2019 que modifica la 3280); examen clínico anual 40–49 años (lineamiento MinSalud).
- **Retirado (2026-10-09):** edades y periodicidad colombianas de FIT (50–75, cada 2 años) y de PSA con tacto rectal (50–75, cada 5 años): no se encontraron en fuentes consultables. El texto remite a la resolución vigente.
- **Verificado (secundario, 2026-10-09):** citología 1-3-3 de 25 a 29 años, ADN-VPH de 30 a 65 años cada 5 años si es negativa, VIA-VILI con tratamiento inmediato en zonas de difícil acceso por personal entrenado y certificado, y repetir ADN-VPH a los 18 meses con citología de triaje negativa (GPC 2014 y documentos que la resumen; la Res. 3280 fija la prueba molecular de 30 a 65).
- **Retirado (2026-10-09):** edades de 30 a 50 años e «intervalo no mayor de 3 años» para VIA-VILI: no se encontraron en las fuentes consultadas.

## desnutricion-aguda-infantil
- **Verificado (secundario, 2026-10-09):** Resolución 115 del 27 de enero de 2026 (modifica parcialmente la 2350): atención al riesgo de desnutrición aguda con puntaje Z > −2 y < −1 DE; F-100 obligatorio en el tratamiento intrahospitalario y ambulatorio y disponibilidad de F-75, F-100 y FTLC por las EPS; el egreso con Z ≥ −2 se considera insuficiente (recuperación con Z ≥ −1 según fuente secundaria). Sivigila «evento 113» confirmado (protocolo actualizado en 2023; Circular 028 de 2025).
- **Retirado (2026-10-09):** «la Res. 115 ordena garantizar fórmula de inicio a menores de 6 meses»: no se encontró en las fuentes consultadas.
- **Verificado (secundario, 2026-10-09):** ampicilina 50 mg/kg IM o IV cada 6 h por 2 días, luego amoxicilina oral por 5 días, más gentamicina 7,5 mg/kg una vez al día por 7 días (recomendación OMS registrada en la base BIGG); ReSoMal 5 mL/kg cada 30 min las primeras 2 h, choque 15 mL/kg en 1 h repetible una vez y transfusión 10 mL/kg en 3 h si no mejora (tabla de revisión que reproduce la guía OMS); F-75 130 mL/kg/día en 8 a 12 tomas (protocolo hospitalario basado en la OMS y ficha del fabricante).
- **Verificado con una sola fuente secundaria:** F-75 100 mL/kg/día con edema +++ (material docente); contrastar con el manual de la OMS.
- **Retirado (2026-10-09):** «puntaje Z de −1 DE o más» como umbral de egreso de la Res. 115: el texto de la resolución dice «hasta que el niño alcance un peso adecuado para su talla o longitud» y el valor no se encontró en las fuentes consultadas. El texto remite al anexo técnico.

## hemorragia-posparto
- **Verificado (secundario, 2026-10-09):** tabla de choque del Código Rojo (Rev Colomb Obstet Ginecol 2009): leve 16–25 %, pulso 91–100, sistólica 80–90; moderado 26–35 %, pulso 101–120, sistólica 70–79 (corregido: decía 70–80); severo > 35 %, pulso > 120, sistólica < 70. Umbral OMS/FIGO/ICM del 5 de octubre de 2025: actuar desde 300 mL con signos vitales anormales o desde 500 mL.
- **Retirado (2026-10-09):** cifras de la fila «compensado» (500–1 000 mL, 10–15 %) y los cortes de signos vitales anormales de la guía 2025 (pulso > 100, índice de choque > 1, sistólica < 100, diastólica < 60): no confirmados en las fuentes consultadas.

## anticoncepcion
- **Verificado (secundario, 2026-10-09):** implante y DIU con menos de 1 embarazo por cada 100 usuarias al año en uso típico (tabla del CDC y resumen de la HHS); la 6.ª edición de los criterios de elegibilidad de la OMS salió el 3 de noviembre de 2025, diez años después de la 5.ª.
- **Retirado (2026-10-09):** porcentajes exactos de píldora, parche, anillo, inyectable y condón (7, 4 y 13): las fuentes dan cifras distintas según la edición de la tabla (la del MMWR de 2014 da 9, 6 y 18). Retirado también «la 6.ª edición actualizó 112 recomendaciones», no encontrado.
- **Corregido (2026-10-09):** métodos de solo progestágeno en la lactancia antes de 6 semanas: la 5.ª edición de la OMS pone píldora e implante en categoría 2 y el inyectable trimestral en 3 (material docente OMS 2022 y artículo de GHSP); el texto decía categoría 2 para los tres «según la OMS 2025», que no se pudo confirmar.
- **Pendiente:** categorías puntuales de la 6.ª edición (2025), que no se pudieron leer.

## hemorragia-digestiva
- **Verificado (secundario, 2026-10-09):** ESGE 2021: no suspender la aspirina de prevención secundaria y, si se suspendió, reanudarla lo antes posible, idealmente en 3–5 días (la frase «hacia el día 3» es de la ESGE 2015). Vasoactivos: terlipresina 2 mg IV cada 4 h por 48 h y luego 1 mg cada 4 h (dos revisiones concordantes); octreotide 50 µg en bolo y 50 µg/h, y somatostatina 250 µg en bolo y 250–500 µg/h (una tabla de revisión; otra revisión usa somatostatina 500 µg y 500 µg/h).
- **Pendiente:** contrastar las dosis con la tabla de la guía AASLD 2016 (Hepatology 2017).

## anafilaxia
- **Verificado (secundario, 2026-10-09):** observación escalonada del Resuscitation Council UK 2021 (2 h con una dosis y buena respuesta, dos autoinyectores y acompañamiento; mínimo 6 h con dos dosis o reacción bifásica previa; mínimo 12 h en reacción grave con más de dos dosis, asma grave, absorción continua, consulta nocturna o acceso difícil a urgencias), adoptada por NICE NG258.
- **Corregido (2026-10-09):** NICE NG258 (27 de mayo de 2026) reemplazó a CG134; se retiró la frase «observar a los mayores de 16 años 6 a 12 horas» de CG134 y los menores de 16 se hospitalizan solo si no cumplen los criterios de alta.

## dolor-abdominal-agudo-apendicitis
- **Verificado (secundario, 2026-10-09):** WSES 2020 (recomendación 7.2, 1A): no prolongar el antibiótico posoperatorio más de 3–5 días en la apendicitis complicada con control adecuado del foco. Existe una actualización WSES 2025 que no se revisó.

## malaria
- **Verificado (secundario, 2026-10-09):** cloroquina 25 mg base/kg en 3 días repartida 10 / 7,5 / 7,5 mg/kg (estudio colombiano que cita la guía 2010; un ensayo de Antioquia usa 600 / 450 / 450 mg en adultos, proporción equivalente).
- **Pendiente:** confirmar en la GPC 67-2022 si conserva el reparto 10 / 7,5 / 7,5.

## sifilis
- **Corregido (2026-10-09):** la regla de la CDC 2021 no es «si se pierde una dosis»: el intervalo óptimo es de 7 días y, en la gestante, más de 9 días entre dosis obliga a repetir el esquema completo (página de sífilis latente de la CDC y resumen del departamento de salud de Maine). Algunas guías estatales recientes (California 2025) son más estrictas: reiniciar ante cualquier dosis tardía.

## infecciones-piel-tejidos-blandos
- **Verificado (secundario, 2026-10-09):** piperacilina/tazobactam 3,375 g cada 6–8 h en la infección necrosante (material docente basado en IDSA 2014).
- **Retirado (2026-10-09):** vancomicina «30 mg/kg/día en 2 dosis»: no se encontró en las fuentes consultadas y hay una carta en CID 2015 sobre discrepancias de dosis en esa guía; el texto remite a la dosis por peso del protocolo institucional con niveles.

## consumo-de-alcohol
- **Verificado (secundario, 2026-10-09):** dosis dirigidas por síntomas con CIWA-Ar (diazepam 10–20 mg o lorazepam 2–4 mg, reevaluación horaria); acamprosato 666 mg tres veces al día con 60 kg o más (666/333/333 mg con menos de 60 kg), naltrexona 50 mg al día y disulfiram desde 200 mg al día (formularios del NHS que aplican NICE CG115).
- **Corregido (2026-10-09):** NICE CG115 dice «considerar una evaluación integral para todos los adultos remitidos a servicios especializados con AUDIT mayor de 15» (página de prioridades de NICE); el texto omitía «remitidos a servicios especializados».

## dolor-cronico-y-opioides
- **Verificado (secundario, 2026-10-09):** naloxona 0,4 a 2 mg IV, IM o SC repetible cada 2–3 minutos (referencias de medicamentos que resumen la ficha); CDC 2022: reevaluar al menos cada 2 semanas si se continúan opioides por dolor agudo.

## gota
- **Verificado (secundario, 2026-10-09):** EULAR 2016: colchicina en las primeras 12 h con 1 mg y 0,5 mg el primer día; prednisolona equivalente 30–35 mg al día por 3–5 días (resumen de la guía en prensa médica; la dosis de prednisolona coincide con resúmenes británicos y con el ensayo de Janssens 2008 con 35 mg).
- **Verificado (secundario, 2026-10-09):** 1 mg y 0,5 mg una hora después, dentro de las primeras 12 h (nota de prensa farmacéutica francesa que cita EULAR y la Sociedad Francesa de Reumatología, y ficha francesa de la colchicina). El texto primario de EULAR 2016 no se pudo leer.

## osteoporosis
- **Verificado (secundario, 2026-10-09):** calcio total 1 000 mg/día en hombres de 50 a 70 años y 1 200 mg/día en mujeres de 51 o más y hombres de 71 o más; vitamina D 800–1 000 UI/día desde los 50 años (resumen de BHOF 2022). DXA en mujeres de 65 años o más y hombres de 70 o más (guía NOF 2014, antecesora de BHOF).
- **Verificado (secundario, 2026-10-09):** BHOF 2022 mantiene DXA en mujeres de 65 años o más y hombres de 70 o más (tabla en PMC que resume la guía 2022); AACE 2020, muy alto riesgo: fractura en los últimos 12 meses, fractura durante el tratamiento, fracturas múltiples, fractura con fármacos que dañan el hueso, T-score menor de −3,0, alto riesgo de caídas o caídas con lesión y FRAX mayor de 30 % (fractura mayor) o de 4,5 % (cadera) (varios resúmenes concordantes).

## sincope
- **Retirado (2026-10-09):** «2–3 litros de agua y 10 g de sal al día»: no se encontró en las fuentes consultadas y las guías difieren en la cantidad de sal (6 a 10 g/día); el texto dice «más agua y más sal si no hay contraindicación».
- **Retirado (2026-10-09):** el detalle de las reglas de conducción de la ESC 2018 (por tipo de síncope y de conductor): tres búsquedas no encontraron su tabla. El texto remite a la tabla de la ESC y a la normativa colombiana, y pide preguntar si el paciente conduce por oficio.

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

## accidente-ofidico
- **Nueva (2026-10-09):** redactada con búsqueda web; 14 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Viales iniciales de antiveneno para Bothrops según gravedad: las fuentes se contradicen (2/4/6; 2–3/4–6/6–10; 2–3/4–6/7–10; 6–8/10–12/20–25); Viales para Lachesis (8, 10–12, 20–25) y para Crotalus (8/12/20 y otras pautas): solo aparecen en tablas institucionales que no coinciden entre sí; Umbrales de fibrinógeno por gravedad (100–130 mg/dL en el moderado, menos de 100 en el grave): otra clasificación colombiana da valores distintos; Umbral de presión intracompartimental para la fasciotomía (más de 30 mmHg): no hay consenso, las fuentes dan 30–40 mmHg; Volumen de dilución (250–500 mL en adultos; 125–250 o 200 mL en niños) y goteo inicial de 10–15 gotas por minuto; Momento de aparición de la enfermedad del suero (1–12, 5–14, 5–20 o 5–24 días); Repetir el antiveneno cada 6 horas según la OMS: no se encontró el texto literal de la OMS; Proporción de casos por Bothrops (94,6 %) y por Crotalus (1 %), casos al año (≈4 500; 4 702 en 2021; 7 013 en 2024) y letalidad (0,57 %); Capacidad del suero INS contra Lachesis (15 mg de L. muta y 50 mg de L. acrochorda): las versiones del inserto no coinciden; Notificación inmediata de las muertes y registro del lote del antiveneno según la Circular 048: no se pudo confirmar; Dosis de adrenalina para las reacciones al antiveneno; volumen de sangre para la prueba del todo o nada (2 mL según la OMS, 5 mL según una fuente colombiana).
- **Pendiente:** No se pudo consultar la guía MinSalud/INS 2019 de atención clínica integral. Hay que confirmar con ella y con el protocolo INS vigente la tabla de viales por género, gravedad y producto, y añadirla si coincide
- **Pendiente:** Confirmar si el suero polivalente INS vigente cubre Lachesis, o qué producto se usa para Lachesis en Colombia
- **Pendiente:** La dosis anticoral difiere entre el protocolo INS (10 ampollas en moderado y grave) y el inserto (5 o 10 según la región): decidir cuál prima
- **Pendiente:** Manitol al 20 % a 1 g/kg (recomendación por consenso, es controvertida) y la condición de corregir la coagulopatía antes de la fasciotomía (viene de una fuente secundaria)
- **Pendiente:** Momento de la redosificación: las guías colombianas antiguas usan 24 h y 12 h; la OMS usa controles más tempranos
- **Pendiente:** Periodicidad de la notificación al Sivigila (semanal) y si las muertes requieren notificación inmediata
- **Pendiente:** 'No requiere prueba de sensibilidad previa' tiene una sola fuente (inserto INS)
- **Pendiente:** Medidas generales sin fuente textual: retirar anillos, evitar inyecciones intramusculares durante la coagulopatía, medir el perímetro de la extremidad
- **Pendiente:** Año exacto de las 'Guías para el manejo de urgencias toxicológicas' de MinSalud citadas
- **Pendiente:** Pertinencia de W59 entre los códigos CIE-10

## enfermedad-de-chagas
- **Nueva (2026-10-09):** redactada con búsqueda web; 16 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Dosis de benznidazol y nifurtimox de la guía colombiana de 2010 (no se pudo leer la sección de tratamiento); Tabla de dosis de la guía OPS 2018 (no se pudo leer el texto primario); Franjas pediátricas antiguas de nifurtimox de CDC por edad (15–20 mg/kg en 10 años o menos; 12,5–15 mg/kg de 11 a 16 años); Letalidad de cerca del 13 % en los brotes de transmisión oral en Colombia entre 1992 y 2014 (una sola fuente); Hemograma de control hacia el día 21 de benznidazol (no se pudo identificar la fuente); Evitar el alcohol hasta 3 días después de terminar benznidazol (solo una fuente secundaria); Frecuencia de dermatitis con benznidazol (25,4 % en el ensayo EQUITY) y de efectos adversos con nifurtimox; Tasa de transmisión congénita y edad exacta de la serología del lactante en el lineamiento colombiano (10 meses); Plazos en horas de la notificación inmediata y de la investigación de campo en el protocolo vigente del INS; Periodicidad anual del electrocardiograma en la forma indeterminada; Título de IFI de 1:32 o más como positivo (guía colombiana antigua).
- **Pendiente:** Contrastar las dosis con la guía colombiana vigente y con la tabla de la guía OPS 2018. Este documento usa CDC, FDA y Brasil 2018, que difieren en el rango para adultos (5 frente a 5–7 mg/kg/día) y en la duración del nifurtimox (60 frente a 90 días)
- **Pendiente:** Confirmar en el protocolo INS 2022 (evento 205) si el caso agudo y el brote se notifican de forma inmediata y la notificación de los crónicos es semanal; esto se tomó del protocolo anterior del Ministerio
- **Pendiente:** Revisar si el plan nacional de eliminación 2025-2031 adopta las metas ETMI Plus para Chagas y si amplía el tamizaje de gestantes más allá de las zonas endémicas
- **Pendiente:** Verificar la edad de la serología de seguimiento del hijo de madre positiva en el lineamiento colombiano (CDC indica 9–12 meses)
- **Pendiente:** Conducta durante la lactancia: CDC recomienda no tratar; otros protocolos solo difieren el tratamiento al posparto
- **Pendiente:** Indicación en adultos mayores de 50 años y en miocardiopatía avanzada según la guía OPS 2018 (la guía cita a CDC y una tabla de Annals)
- **Pendiente:** Disponibilidad de benznidazol y nifurtimox en Colombia, formulación pediátrica y canal de suministro por el programa ETV
- **Pendiente:** Monitoreo de laboratorio durante el tratamiento (hemograma, función hepática): falta la periodicidad

## intoxicacion-por-organofosforados
- **Nueva (2026-10-09):** redactada con búsqueda web; 16 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Dosis de diazepam (10 mg IV) en convulsiones por organofosforados: no hubo fuente con la dosis IV textual; Umbrales de gravedad por colinesterasa (20 a 50 %, 10 a 20 %, menos de 10 %): son de la colinesterasa sérica y otras fuentes dicen que no se correlaciona con la gravedad; Duración del síndrome intermedio (5 a 18 días; 5 a 15 días): una sola fuente o no encontrada; Plazo de la polineuropatía tardía: las fuentes difieren (1 a 4 semanas, 2 a 3 semanas, 8 a 14 días); Dosis pediátrica de pralidoxima (15 mg/kg y luego 10 mg/kg/h según Queensland, frente a 25 mg/kg en reportes de caso); Máximos de pralidoxima (2 g de carga, 650 mg/h) y de atropina pediátrica (3 mg por dosis): una sola fuente; Tiempo de observación del paciente expuesto asintomático antes del egreso; Letalidad de la intoxicación (más del 15 a 20 %; 2 a 40 %): cifras discordantes; Carbón activado 1 g/kg en la primera hora; Esquema de atropina de la guía colombiana de 2008 (2 a 5 mg y luego 1 mg cada 5 minutos): no se pudo confirmar en el PDF oficial; Periodicidad semanal y definición de caso (inicio dentro de 14 días) del evento 365 en el protocolo vigente del INS.
- **Pendiente:** Contrastar con el capítulo de inhibidores de colinesterasa de la guía MinSalud-OPS 2017 (dosis de atropina, indicación y dosis de pralidoxima, lavado gástrico y carbón activado): no se pudo leer el texto de ese capítulo
- **Pendiente:** Confirmar en el texto completo de la revisión Lancet 2008 el bolo de 1,8 a 3 mg con duplicación cada 5 minutos (verificado solo en protocolos que lo citan)
- **Pendiente:** La guía del Ministerio de Salud de El Salvador (Acuerdo 2968) apareció en una búsqueda atribuida por error a Chile; confirmar el país y el año
- **Pendiente:** Confirmar en el protocolo vigente del INS las reglas de notificación 365 frente a 356 y la periodicidad
- **Pendiente:** Dosis de benzodiacepinas y dosis pediátrica de pralidoxima según la fuente primaria
- **Pendiente:** Disponibilidad de pralidoxima y obidoxima en Colombia (INVIMA, nivel de atención) y si la guía colombiana mantiene la recomendación de oximas pese a la conclusión de Cochrane
- **Pendiente:** Uso de oximas en intoxicación por carbamatos o por un agente desconocido

## leishmaniasis
- **Nueva (2026-10-09):** redactada con búsqueda web; 16 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Intralesional según OPS 2022 para 1 a 3 lesiones de 3 cm o menos: solo una fuente secundaria; un esquema anterior hablaba de 4 lesiones de hasta 4 cm; Anfotericina B liposomal en la forma visceral: 3 mg/kg/día por 7 días o 4 mg/kg/día por 5 días (solo una fuente brasileña); dosis total de 15 a 30 mg/kg (MSF); Anfotericina B deoxicolato de 0,5 a 1 mg/kg/día y su dosis total; Pentoxifilina 400 mg cada 8 horas en la forma mucosa; Miltefosina de 1,5 a 2,5 mg/kg/día con máximo de 150 mg/día y dosis pediátricas para menos de 30 kg; Umbral de QTc de 500 ms para suspender el antimonial; Número de sesiones de termoterapia (una sola según la OPS frente a tres por semana en otra fuente); Porcentaje de sensibilidad del frotis directo; Calendario oficial de seguimiento de MinSalud (45 días, 3, 6 y 12 meses); Definición de caso del INS con más de 2 semanas de evolución de la lesión; Duración de 30 días en la forma mucosa (Brasil), distinta de los 28 días de Colombia.
- **Pendiente:** Versión vigente de la guía de MinSalud: solo se encontró la de 2010; confirmar si hay actualización de 2018 o posterior y si mantiene 'sin límite de dosis'
- **Pendiente:** Criterios de selección (número y tamaño de lesiones, localización), técnica y número de infiltraciones del lineamiento intralesional de MinSalud 2024
- **Pendiente:** Pentamidina en Colombia: número de dosis y si los 4 mg/kg son de sal o de base
- **Pendiente:** Dosis y esquema de anfotericina B liposomal y deoxicolato en las formas visceral y mucosa, en adultos y niños
- **Pendiente:** Termoterapia: número de sesiones y criterios de lesión elegibles
- **Pendiente:** Disponibilidad actual de la prueba de Montenegro en Colombia
- **Pendiente:** Criterios y plazos oficiales de curación y seguimiento para las formas cutánea, mucosa y visceral
- **Pendiente:** Miltefosina en niños de menos de 30 kg y su lugar en la guía colombiana
- **Pendiente:** Frecuencia del electrocardiograma durante el tratamiento y criterio de suspensión por QTc
- **Pendiente:** Manejo de gestantes con forma mucosa o visceral

## leptospirosis
- **Nueva (2026-10-09):** redactada con búsqueda web; 21 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Incubación habitual de 5 a 14 días (OMS 2003): no se encontró el texto; el Manual MSD da de 2 a 20 días; Proporción de formas graves o síndrome de Weil del 5 al 10 %: solo la dan fuentes secundarias; Letalidad del síndrome de Weil del 5 al 15 %; Título MAT único igual o mayor de 1:800 (criterio peruano) y de 1:400 para muerte probable (fragmento ambiguo del INS 2024); Umbral numérico de seroconversión MAT del INS: las fuentes dicen tanto 'cuatro diluciones' como 'cuatro veces'; Ceftriaxona 2 g IV durante 72 h y luego 1 g IM al día (fuente no identificada); Ceftriaxona pediátrica 80 a 100 mg/kg/día (solo la da MSF); Doxiciclina pediátrica 2 a 4 mg/kg/día (solo la da BMJ); Duración de la azitromicina (3 días en adultos; no establecida en niños); Dosis máxima de penicilina de 24 millones de U/día (solo en los lineamientos de El Salvador); Doxiciclina profiláctica 100 mg semanal entre 8 y 12 años (solo Argentina); Iniciar la profilaxis 1 a 2 días antes de la exposición; Amoxicilina 2 g/día (OMS 2003); Periodicidad de notificación (semanal o inmediata) y unidad de análisis de las muertes.
- **Pendiente:** Verificar en el PDF del protocolo INS 2024 si la ELISA IgM positiva forma parte de la definición de caso probable o es un criterio de clasificación posterior, dado que se notifica antes de tener el resultado
- **Pendiente:** Confirmar el criterio de seroconversión MAT del INS: incremento de cuatro diluciones frente a cuatro veces el título
- **Pendiente:** Confirmar la periodicidad de notificación y el manejo de las muertes (unidad de análisis) en el protocolo 2024
- **Pendiente:** Discrepancias de dosis en adultos: amoxicilina cada 6 h (CDC) frente a cada 8 h (MinSalud 2009); penicilina 1,5 millones de U (CDC) frente a 2 a 4 millones de U cada 6 h (MinSalud 2009). Verificar también si hay una guía clínica MinSalud/INS vigente posterior al protocolo de 2009
- **Pendiente:** Amoxicilina pediátrica: la herramienta MinSalud da 25 a 50 mg/kg/día y el protocolo de 2009 '40-50 mg/kg cada 8 horas', con una transcripción ambigua
- **Pendiente:** Quimioprofilaxis: no se encontró una recomendación colombiana vigente; el esquema se tomó de la nota técnica brasileña de 2024
- **Pendiente:** Los criterios de hospitalización se redactaron a partir de las manifestaciones de gravedad del INS 2024 y de los CDC, no de una lista oficial
- **Pendiente:** Incubación: ECDC da de 2 a 30 días y el Manual MSD de 2 a 20 días

## mordeduras-y-profilaxis-de-rabia
- **Nueva (2026-10-09):** redactada con búsqueda web; 20 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Periodicidad formal del evento 300 (inmediata o semanal) y del evento 670 de rabia humana: las fuentes se contradicen. Solo quedó 'diligenciar de inmediato', como dice MinSalud; Suspender la vacuna si el animal sigue sano al quinto día de observación (boletín MinSalud 2015): no se encontró en los lineamientos vigentes; Quinta dosis el día 28 en inmunosuprimidos y suero también en exposición leve (categoría II) en inmunosuprimidos: las fuentes se contradicen; Número de dosis previas que define a alguien como 'previamente vacunado' (al menos 2 dosis) y esquema colombiano específico de reexposición; Dosis pediátricas de metronidazol, clindamicina y doxiciclina para alérgicos a la penicilina; Duración exacta del tratamiento de una herida ya infectada (de 7 a 10 días), que solo aparece en una fuente secundaria; Período de observación de 14 días (fuente antigua y no confiable); Que la vacuna y el suero no requieran ajuste en la insuficiencia renal: no se buscó ni se verificó, así que no se escribió; Cifras de agresiones notificadas en 2024 (unas 180 000): no hacían falta en la guía.
- **Pendiente:** Confirmar en el lineamiento vigente de MinSalud e INS que el esquema de 4 dosis (0, 3, 7 y 14) reemplazó al de 5 dosis de la guía de 2009, y que aplica tanto a la exposición leve como a la grave. El documento de escenarios del PAI no tiene fecha visible
- **Pendiente:** Contrastar con el algoritmo actual del INS la definición de 'no exposición': si un perro o gato observable y sano que muerde en la cara o la mano queda en 'no exposición' con observación, frente a los criterios por localización de la guía de 2009
- **Pendiente:** Verificar si Colombia adoptó la regla de la OMS 2018 de no aplicar el sobrante del suero por vía intramuscular, o si sigue la de 2009 (resto en el glúteo). Verificar también si el inserto del suero disponible en Colombia aún exige prueba cutánea
- **Pendiente:** El límite de 7 días para la inmunoglobulina proviene de la ficha técnica de HyperRAB y de guías de Estados Unidos, no de la guía colombiana
- **Pendiente:** El umbral de 3 meses para la reexposición sin vacuna proviene de diapositivas que resumen a la OMS 2018: confirmarlo en el documento WER 2018
- **Pendiente:** Dosis pediátrica de amoxicilina-clavulanato: verificar la tabla original de IDSA 2014; la cifra proviene de protocolos pediátricos (UCSF, Children's Mercy)
- **Pendiente:** Tétanos: IDSA da 10 años y CDC da 5 años para heridas contaminadas. Definir cuál adoptar y si en Colombia se usa Td o Tdap
- **Pendiente:** La regla de no reiniciar el esquema si se retrasa una dosis proviene de un acta distrital de Bogotá (2023): confirmarla en el lineamiento nacional
- **Pendiente:** Disponibilidad real en Colombia de la inmunoglobulina antirrábica humana frente al suero equino

## crecimiento-y-desarrollo-infantil
- **Nueva (2026-10-09):** redactada con búsqueda web; 19 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Puntos de corte en DE del IMC para la edad en menores de 5 años y en 5 a 17 años (delgadez, riesgo de delgadez, sobrepeso, obesidad); Puntos de corte del peso para la edad (riesgo de desnutrición global de −2 a <−1 DE); Rango de edad exacto de la EAD-3 (0 a 6 años según MinSalud en prensa frente a 0 a 7 años en los estudios de validación) y puntajes típicos por edad; Sensibilidad del 100 % y especificidad del 40 % de la EAD-3 (un solo estudio, 24 niños); Dosis de hierro de 24 a 59 meses en la ruta (los resúmenes discrepan: 3 mg/kg/día frente a 2 mg/kg/día por 30 días cada 6 meses); Esquema de los micronutrientes en polvo (ciclo cada 6 meses, número de sobres); Vitamina A en la ruta colombiana para 6 a 11 y 12 a 23 meses (resúmenes contradictorios); Umbral de anemia del 20 % para los micronutrientes en polvo (OMS); Definición de primera infancia en la Res. 3280 (8 días a 5 años, 11 meses y 29 días); Periodicidad de la consulta de salud bucal desde los 6 meses; Medición rutinaria del perímetro cefálico hasta los 3 años; Longitud en decúbito hasta los 2 años y talla de pie después; Ausencia de palabras sueltas a los 16 meses como signo de alarma.
- **Pendiente:** Contrastar el cronograma de consultas de primera infancia con el cuadro modificado por la Res. 276 de 2019
- **Pendiente:** Verificar en el texto oficial de la Res. 3280 la dosis y la edad de inicio de vitamina A, hierro en preescolares, micronutrientes en polvo y albendazol 400 mg (esta dosis sale de un protocolo derivado y de la OMS, no del texto oficial)
- **Pendiente:** Completar desde el anexo técnico de la Res. 2465 los puntos de corte del IMC para la edad (0-5 y 5-17 años) y del peso para la edad
- **Pendiente:** Confirmar el rango de edad de la EAD-3 y en qué consultas es obligatoria
- **Pendiente:** Confirmar los criterios AIEPI de cada clasificación del desarrollo
- **Pendiente:** Los signos de alarma por edad (balbuceo, frases de dos palabras) vienen de fuentes no colombianas: contrastar con AIEPI y el manual de la EAD-3
- **Pendiente:** Revisar que los códigos CIE-10 elegidos sean adecuados (R62.0, R62.8, E34.3, Q02, F80.9, F82, F88, F89, E44.1)

## diabetes-gestacional
- **Nueva (2026-10-09):** redactada con búsqueda web; 24 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Criterios NDDG de la PTOG de 100 g (105/190/165/145 mg/dL): ningún resultado los confirmó; Riesgo de diabetes tipo 2 tras DMG de 50–70 % en 15–25 años: las fuentes no coinciden (cerca de 50 %, más de la mitad en 10 años, 70 % de por vida); Parto en DMG mal controlada a las 37 0/7–38 6/7 semanas: otra adaptación dice 36 0/7–38 6/7 y el CO 831 dice individualizar; Ofrecer cesárea programada en diabéticas con peso fetal estimado ≥4 500 g (ACOG 190): no verificado; Dosis de ejercicio para DMG (150 min/semana, 30 min 5 días/semana): fuentes contradictorias; Dosis inicial de NPH nocturna de 0,2 U/kg: una sola fuente; Requerimientos de insulina por trimestre (0,8/1,0/1,2 U/kg/día): una sola fuente; NICE: considerar insulina con ayunas de 6,0–6,9 mmol/L si hay macrosomía o polihidramnios: no verificado; Puntos de corte de la PTOG atribuidos textualmente a la Resolución 3280: no se encontró el texto; Meta alternativa de HbA1c <7 % (ADA): no verificada; Porcentaje de DMG controlada solo con dieta (70–85 %): no buscado ni verificado; Proporción de 26–46 % que necesita insulina con metformina: se dejó solo 'cerca de la mitad' (SMFM); Umbrales de diabetes manifiesta en el primer control (≥126 mg/dL, HbA1c ≥6,5 %): no se reverificaron; el texto remite a los criterios estándar sin cifras; Conversión a mg/dL de los umbrales de NICE: se dejaron solo en mmol/L.
- **Pendiente:** Confirmar en el anexo técnico de la Resolución 3280 de 2018 los puntos de corte de la PTOG y qué hacer ante una glicemia de ingreso alterada
- **Pendiente:** La dosis inicial de insulina de 0,7–1,0 U/kg/día no se verificó en el texto primario de ACOG ni de ADA; contrastar o atribuir bien
- **Pendiente:** La meta de NICE a las 2 h (6,4 mmol/L) y los umbrales de 100 g de dos pasos solo se verificaron en resúmenes secundarios
- **Pendiente:** Momento del parto en DMG mal controlada o con complicaciones: contrastar con ACOG CO 831
- **Pendiente:** Ya existe la edición 2026 de los Standards de ADA (Diabetes Care 49 Suppl 1, sección 15): revisar cambios frente a 2025
- **Pendiente:** Tabla 1 de factores de riesgo de la actualización ACOG 2024 y prueba preferida para el tamizaje temprano
- **Pendiente:** No se pudo abrir el texto primario de ninguna guía (WebFetch no funciona); casi todas las cifras se verificaron en resúmenes y revisiones
- **Pendiente:** Manejo neonatal (umbrales y horario de glucometrías del recién nacido) no incluido; remitir a la guía neonatal correspondiente

## escabiosis-y-pediculosis
- **Nueva (2026-10-09):** redactada con búsqueda web; 23 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Más de 200 millones de personas con escabiosis (OMS): no apareció en el texto de la nota descriptiva, solo en revisiones; Prevalencia acumulada en Colombia 2009–2019 de 5,3 por 100 000: verificada, pero viene de un informe no publicado; se omitió; Concentración del azufre precipitado (5–10 % frente a 6 %): no se verificó en la guía vigente de los CDC; Benzoato de bencilo al 25 % en sarna costrosa (CDC): no se verificó la concentración; Duración de la bolsa plástica para escabiosis (72 horas frente a 7 días): las fuentes difieren, así que se usó la frase de los CDC 'varios días a una semana'; Edad mínima del spinosad (4 años frente a 6 meses): fuentes contradictorias; se omitió el producto; Regreso al colegio o al trabajo el día siguiente al tratamiento de escabiosis: no se verificó; Definición de brote institucional de escabiosis (2 o más casos) y código o evento específico en el Sivigila: no se encontraron; Año del lineamiento de escabiosis de MinSalud: no se pudo confirmar; Liendres a más de 1/4 de pulgada del cuero cabelludo, no viables: no se buscó; Dosis de ivermectina oral para la pediculosis: no se buscó.
- **Pendiente:** Contrastar con el texto completo de AAP 2022 (Pediatrics) el intervalo de repetición de la permetrina al 1 % (7 a 10 días o día 9), el algoritmo para la resistencia y las edades de cada alternativa; lo verificado proviene de informes AAP anteriores y de los CDC
- **Pendiente:** Verificar en el PDF de IUSTI 2017 los intervalos de permetrina (7 a 14 días) e ivermectina (7 días) y el esquema de benzoato de bencilo; se verificaron por un resumen secundario
- **Pendiente:** Lineamiento de escabiosis de MinSalud: año, conducta ante brotes, definición de brote y mecanismo de notificación al INS y al Sivigila (el texto solo dice 'informar a la secretaría de salud territorial')
- **Pendiente:** Registro Invima en Colombia de ivermectina tópica al 0,5 %, malatión, alcohol bencílico, dimeticona al 4 % y azufre magistral
- **Pendiente:** Aplicación de permetrina en cuero cabelludo y cara en lactantes y adultos mayores: las guías difieren
- **Pendiente:** Tratamiento en menores de 2 meses (permetrina fuera de indicación frente a azufre) y evidencia emergente de ivermectina en niños de menos de 15 kg
- **Pendiente:** Tratamiento simultáneo de residentes, personal y visitantes en brotes institucionales: no se verificó textualmente en la página de los CDC
- **Pendiente:** Los criterios de remisión u hospitalización se redactaron por criterio clínico; ninguna guía los fija explícitamente
- **Pendiente:** Inflamabilidad del malatión: no se verificó con búsqueda

## lactancia-materna
- **Nueva (2026-10-09):** redactada con búsqueda web; 17 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Lactancia exclusiva en Colombia del 36,1 % según ENSIN 2015 (solo hallada en fuente secundaria del Concejo de Bogotá); Umbral de 12 a 24 h (o 24 h) sin mejoría para iniciar antibiótico en mastitis: hay discrepancia entre resúmenes y no hallé el texto de ABM 2022; Dosis de clindamicina en mastitis (las fuentes dan 300 mg cada 6 h, 300 mg cada 8 h y 300-450 mg cada 8 h); Absceso en el 3 a 11 % de las mastitis (fuente única no autoritativa); Ibuprofeno 800 mg en mastitis según ABM 2022 (no verificado); 6 o más pañales mojados al día desde el día 5 (las fuentes no coinciden); Varicela materna entre 5 días antes y 2 días después del parto como contraindicación temporal (solo en tabla secundaria, no en CDC); Ley 1823 de 2017: umbral de capital de 1 500 SMLMV o más de 50 trabajadores para salas de lactancia (fuente secundaria única); ABM 2010/2017: 6 a 8 h a temperatura ambiente en condiciones muy limpias (parece corresponder a la versión de 2010); Número de sesiones de apoyo a la lactancia en la Res. 3280 de 2018 (no encontrado).
- **Pendiente:** Confirmar en el texto de ABM 2022 (protocolo 36) el criterio de tiempo para iniciar antibiótico, la recomendación sobre masaje profundo y drenaje linfático, y la duración del antibiótico
- **Pendiente:** Confirmar que la GPC colombiana de VIH en menores de 13 años (fórmula hasta los 12 meses) sigue vigente y si la GPC VIH 2021 o la ruta materno perinatal la modificaron
- **Pendiente:** Verificar en la página de CDC la frase 'contadas desde que quedó completamente descongelada' para las 24 h en nevera
- **Pendiente:** Contrastar con la fuente primaria los criterios de 8 a 12 tomas, pérdida de hasta el 10 % y recuperación del peso a las 2 semanas (atribuidos a protocolos hospitalarios del NHS y de Australia, no a la OMS ni a la AAP)
- **Pendiente:** Verificar en la Res. 3280 de 2018 qué atenciones de promoción y apoyo de la lactancia incluye la ruta materno perinatal
- **Pendiente:** Revisar si la AAP actualizó la recomendación de vitamina D de 2008 y si MinSalud la adopta
- **Pendiente:** Revisar el lineamiento vigente del PAI sobre la vacuna de fiebre amarilla en la mujer lactante (la Circular 014 de 2017 habla de precaución; puede haber una circular posterior, de 2024)
- **Pendiente:** Revisar el criterio actual de CDC/AAP 2024 sobre VIH con supresión viral sostenida y lactancia (decisión compartida en EE. UU.) frente a la norma colombiana
- **Pendiente:** Confirmar la referencia completa del policy statement de la AAP 2022 (Pediatrics 2022;150:e2022057988)

## parasitosis-intestinal
- **Nueva (2026-10-09):** redactada con búsqueda web; 22 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Edades y periodicidad de la desparasitación en el anexo técnico de la Resolución 3280 de 2018 (no se encontró el texto); Dosis pediátrica de metronidazol en giardiasis (15 mg/kg/día en 3 dosis): no verificada; las fuentes usaron esquemas distintos; Metronidazol por 5 a 7 días en giardiasis (solo se verificaron 5 días y el rango Cochrane de 5 a 10 días); Paromomicina 25 a 35 mg/kg/día en 3 dosis: las fuentes difieren (otra da 10 mg/kg cada 8 h por 7 días); Pamoato de pirantel 11 mg/kg en dosis única para ascariasis (no verificado en ascariasis); Ivermectina 150 a 200 µg/kg en ascariasis: CDC la lista, pero una tabla de PMC la da como no recomendada; Prevalencia de geohelmintos por región en la ENPI (Amazonía 81,8 %, Sierra Nevada 74,0 %, cinturón árido pericaribeño 56,8 %): fuente única y posible confusión con la encuesta de 1980; Número de muestras analizadas en la ENPI (fuente única); Albendazol 200 mg para oxiuros en menores de 2 años (solo aparece en WikEM).
- **Pendiente:** Contrastar con el informe oficial de la ENPI 2012-2014 las cifras tomadas de fuentes secundarias: 81 % general, Blastocystis 60 % y prevalencias por especie
- **Pendiente:** Confirmar en el anexo técnico vigente de la Resolución 3280 de 2018 (y en la Resolución 276 de 2019) las edades y la periodicidad de la desparasitación, y si el lineamiento de 2013 sigue vigente
- **Pendiente:** Revisar la disponibilidad en Colombia (registro INVIMA) de tinidazol, nitazoxanida, paromomicina, yodoquinol y pamoato de pirantel, y si conviene mencionar alternativas locales como el secnidazol
- **Pendiente:** Dosis pediátricas de metronidazol en giardiasis y amebiasis, y dosis del agente luminal
- **Pendiente:** Paromomicina en la gestante con giardiasis: la fuente es un departamento de salud estatal de EE. UU.; contrastar con una guía obstétrica
- **Pendiente:** Ivermectina en menores de 15 kg: la ficha técnica no establece su seguridad, pero un metaanálisis sugiere que es segura; decidir la redacción
- **Pendiente:** Si alguna parasitosis intestinal o brote es evento de notificación al Sivigila (no se incluyó por no estar verificado)

## sangrado-primer-trimestre
- **Nueva (2026-10-09):** redactada con búsqueda web; 23 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Manejo expectante: expulsión completa en cerca del 80 % en 8 semanas (ACOG). Las fuentes secundarias no coinciden en si las 8 semanas son de gestación o de espera; Intervalo de la dosis repetida de misoprostol según ACOG (no antes de 3 h, dentro de 7 días): no se encontró el texto; Tasas de expulsión con mifepristona más misoprostol frente a misoprostol solo (83,8 % frente a 67,1 %; 83 % frente a 76 %): verificadas pero no incluidas, por espacio; Evitar el embarazo durante 3 meses después del metotrexato: no verificado; Beta-hCG 7 días después de la salpingostomía (NICE): no verificado; Manejo expectante del ectópico con beta-hCG menor de 200 mUI/mL (ACOG): no buscado ni verificado; Aumento mínimo de la beta-hCG en 48 h según ACOG (35 % o 49 %): no verificado; Dosis de anti-D según ACOG (50 µg frente a 300 µg) y recomendación de la OMS sobre anti-D antes de las 12 semanas: no verificadas; Masa ectópica de 3,5 cm como contraindicación relativa en ACOG: contradicho (ACOG 193 dice 4 cm); Consultar de nuevo si el sangrado persiste después de las 14 semanas (NICE): no verificado; Plazo máximo para la respuesta a la solicitud de IVE en Colombia: no verificado.
- **Pendiente:** Restricción anti-D de NICE (no hasta 11+6 semanas; al menos 250 UI desde las 12+0): año exacto y redacción de la actualización de NG126, tomados de un resumen de búsqueda
- **Pendiente:** Si la actualización de ACOG 2024 sobre Rh también cubre el embarazo ectópico (la guía la limita al aborto espontáneo o inducido)
- **Pendiente:** Regla de NICE para menos de 6 semanas con prueba en orina a los 7 a 10 días: solo la respalda una fuente secundaria
- **Pendiente:** Lista de contraindicaciones absolutas del metotrexato en el Box 1 de ACOG 193, y si la imposibilidad de seguimiento es absoluta o relativa (sin cifras, redactada de memoria)
- **Pendiente:** Hora de la doxiciclina preoperatoria (1 h frente a 30–60 min) y si ACOG 200 la recomienda textualmente
- **Pendiente:** Seguimiento de la mola (56 días, 6 meses, dos resultados normales con 4 semanas de diferencia): tomado del resumen de BMJ Best Practice, no del texto primario de RCOG GTG 38
- **Pendiente:** Atribución a ACOG 200 de los criterios de la SRU: confirmada con ASA, Radiopaedia y HSE, no con la tabla de ACOG
- **Pendiente:** NICE: salpingectomía frente a salpingostomía y criterios para preferir manejo médico o quirúrgico sobre el expectante (sin cifras, de memoria)
- **Pendiente:** Resolución 051 de 2023: vigencia actual, alcance de la objeción de conciencia y autonomía de las menores de 14 años (fuente: ACI Prensa)
- **Pendiente:** Signos clínicos de la mola descritos sin fuente buscada (útero grande, hiperémesis, hipertiroidismo, preeclampsia temprana)

## vacunacion-pai-y-adulto
- **Nueva (2026-10-09):** redactada con búsqueda web; 17 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Intervalo de 4 semanas entre las dos dosis de influenza en la primera vacunación infantil (no se verificó en el lineamiento colombiano); Ventana CDC de Tdap entre las semanas 27 y 36; Edad máxima de pentavalente, DPT, polio y neumococo en esquemas de recuperación; Edad mínima de contraindicación absoluta de fiebre amarilla (6 meses) y límite de 60 años como contraindicación; Esquema de neumococo para adultos dentro del PAI colombiano (edad y vacuna); Valencia de la vacuna neumocócica del PAI (la infografía 2025 dice trecevalente; no se confirmó); Edad de 19 a 49 años con riesgo para neumococo (CDC); Influenza universal desde los 6 meses (CDC) y dosis alta en mayores de 65 años; Esquema primario de Td en adulto no vacunado según CDC (0, 4 semanas, 6–12 meses); Fecha exacta del cambio del refuerzo de triple viral a 18 meses (una fuente dice enero de 2023).
- **Pendiente:** Confirmar en el afiche o lineamiento PAI 2026 si el ajuste por tosferina (6 semanas, 3 y 4,5 meses) sigue vigente o si se volvió al calendario de 2, 4 y 6 meses, y qué vacunas incluye (rotavirus y neumococo tienen 2 dosis primarias)
- **Pendiente:** Refuerzo de triple viral: MinSalud y Bogotá lo ponen a los 18 meses, pero una web secundaria de 2026 aún lo pone a los 5 años; verificar en el afiche 2026
- **Pendiente:** Edad de fiebre amarilla en el esquema regular (18 meses según la Circular 027 de 2015; un esquema distrital de 2025 parecería ubicarla a los 12 meses) y el alcance vigente de la Resolución 691 de 2025 y de la Circular 001 de 2026
- **Pendiente:** Semana de Tdap en gestantes: la Circular 011 de 2025 dice semana 26 (20 en rural disperso) y el ajuste de noviembre de 2025 dice semana 20 para todas; confirmar cuál rige
- **Pendiente:** Límite de la segunda dosis de rotavirus (11 meses y 29 días según el afiche 2026); esquemas antiguos usaban límites menores
- **Pendiente:** Si los refuerzos de 18 meses y 5 años son con DPT, pentavalente o polio inactivada u oral en el esquema vigente
- **Pendiente:** Oferta de neumococo y VSR para adultos y gestantes dentro del PAI colombiano
- **Pendiente:** Vigencia de las recomendaciones CDC/ACIP, dados los cambios de política en EE. UU. desde 2025
- **Pendiente:** Esquema de Td de 5 dosis: solo una fuente (anexo distrital del PAI) da los intervalos

## conjuntivitis-y-ojo-rojo
- **Nueva (2026-10-14):** redactada con búsqueda web; 23 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Olopatadina 0,1 % dos veces al día / 0,2 % una vez al día y ketotifeno 0,025 % (no encontré la posología verificada); Tiempo de resolución de la hemorragia subconjuntival (las fuentes dicen 1–2 semanas, 7–14 días o 4–6 semanas); Volumen y duración de la irrigación en quemadura química (1–2 L, al menos 2 L, 15–20 min, 30 min: las fuentes difieren); Manitol 1 g/kg si la PIO sigue por encima de 40 mmHg a la hora (una sola fuente local); Esquema de pilocarpina (dosis única y luego 4 veces al día frente a cada 15 minutos: las fuentes difieren); Iridotomía en las 24–48 horas siguientes a la crisis (solo BMJ Best Practice); Regreso al colegio 24 horas después del antibiótico como recomendación de los CDC (no la encontré en una página de los CDC); Resolución espontánea de la conjuntivitis bacteriana en 1–2 semanas según NICE CKS (las fuentes dicen 5–7 días o 2–3 semanas); Código Sivigila 900 para conjuntivitis viral (una sola fuente indirecta); Dosis de aciclovir o ganciclovir en herpes ocular (no la busqué); Precisión del 95 % de la prueba de fenilefrina y prevalencia de artritis reumatoide en la escleritis (fuente poco fiable).
- **Pendiente:** Esquema de cloranfenicol 0,5 % y ácido fusídico 1 %: verificado en formularios del NHS que aplican NICE CKS, no en la página de CKS; confirmar también su disponibilidad en Colombia
- **Pendiente:** La frase de la AAO 2023 sobre el curso de 5 a 7 días viene de una reproducción en Guideline Central; contrastar con el texto del PPP
- **Pendiente:** Povidona yodada 2,5 % de la GPC del recién nacido sano de 2013 (MinSalud): tomada de una reproducción secundaria; verificar en el PDF original y si sigue vigente
- **Pendiente:** Azitromicina 20 mg/kg/día por 3 días en clamidia neonatal: es régimen de la OMS y de MSF; la CDC 2021 solo dice que los datos son limitados
- **Pendiente:** Indicación de hospitalizar todo recién nacido con oftalmía gonocócica
- **Pendiente:** Fármacos de la crisis de glaucoma agudo (acetazolamida, timolol, pilocarpina): salen de protocolos locales de urgencias, no del PPP de la AAO
- **Pendiente:** Exclusión de 14 días para trabajadores de la salud (Public Health Ontario) frente a la política local de salud ocupacional; no encontré norma colombiana sobre regreso al colegio o al trabajo
- **Pendiente:** Fluoroquinolona tópica en usuarios de lentes de contacto: solo fuentes secundarias
- **Pendiente:** Remisión de la escleritis el mismo día: es la práctica habitual, pero no la verifiqué en una guía
- **Pendiente:** Notificación de brotes de conjuntivitis por Sivigila: confirmar el mecanismo vigente del INS

## dermatitis-atopica
- **Nueva (2026-10-14):** redactada con búsqueda web; 22 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Antihistamínico sedante por 7–14 días en mayores de 6 meses (NICE): no encontré el texto original; quedó como 'ciclo corto'; Concentraciones de los ejemplos de corticoides por potencia (hidrocortisona 1 %, clobetasona 0,05 %, betametasona 0,1 %, clobetasol 0,05 %); Unidades punta de dedo por brazo y por pierna (las fuentes dan 3 frente a 4 y 6 frente a 8); Dosis de aciclovir en eccema herpético; Dosis de ciclosporina y de los demás inmunosupresores clásicos; Edad mínima de crisaborol y de ruxolitinib crema; Concentración de los baños con cloro diluido; Prevalencia de la dermatitis atópica en niños y adultos; Franja de 6 meses a 3 años para humectantes en la guía pediátrica de la AAD 2026 (fuente ambigua; no se incluyó).
- **Pendiente:** Confirmar si NICE CG57 sigue vigente o fue reemplazada (una fuente secundaria menciona una guía NICE nueva de 2025) y la redacción actual sobre antihistamínicos
- **Pendiente:** Recomendaciones exactas y grados de la guía pediátrica de la AAD 2026 (solo se consultaron resúmenes de prensa)
- **Pendiente:** Postura de AAAAI/ACAAI 2023 sobre baricitinib y los JAK orales frente a AAD 2024 (difieren en los inmunosupresores clásicos)
- **Pendiente:** Que la valoración oftalmológica el mismo día en eccema herpético periocular sea de la PCDS (no se encontró en el texto de NICE)
- **Pendiente:** Embarazo: posición de EuroGuiDerm sobre dupilumab, inhibidores JAK y potencia de los corticoides tópicos
- **Pendiente:** Contenido y año vigente de la guía colombiana de AsoColDerma (2018, 2020 y actualización 2024) y del consenso de atención primaria con la asociación colombiana de alergia
- **Pendiente:** Disponibilidad en Colombia de flucloxacilina, pimecrolimus, ruxolitinib crema y los biológicos más nuevos (registro INVIMA)
- **Pendiente:** Datos bibliográficos completos (volumen y página) de las referencias AAD 2023, AAD 2024 y AAAAI/ACAAI

## menopausia
- **Nueva (2026-10-14):** redactada con búsqueda web; 18 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Dosis bajas/estándar de estradiol (oral 0,5, 1 o 2 mg; parche de 25 o 50 µg): no hay una equivalencia verificada y las definiciones de dosis estándar difieren entre fuentes; Estradiol en IOP de 100 µg/día transdérmico o 2 mg oral: no verificado en ESHRE 2024; Elinzanetant 120 mg al acostarse: una fuente habla de cápsulas de 60 mg y no se confirmó la dosis diaria; Umbrales de fezolinetant (no iniciar con 2 veces el LSN; suspender con 5 veces, o 3 veces con bilirrubina): una sola fuente secundaria que además discrepaba en el calendario; Venlafaxina meta de 75 mg o hasta 150 mg/día: las fuentes no coinciden; Gabapentina hasta 2 400 mg/día y desvenlafaxina 100–150 mg/día: solo una fuente secundaria; Sangrado no programado más allá de 6 meses como umbral de estudio: discrepa con otra fuente que dice 12 meses; Exceso de cáncer de mama de 3–4 casos por 1 000 mujeres con terapia combinada: no confirmado en NICE; Prevalencia de la premutación FMR1 en IOP (7,5–13 %): fuente previa a 2024, no incluida.
- **Pendiente:** Las dosis de ISRS/IRSN y gabapentina salen de resúmenes secundarios; contrastar con la tabla de NAMS 2023
- **Pendiente:** Cariotipo, FMR1 y anticuerpos anti-21-hidroxilasa/antitiroperoxidasa en IOP se tomaron de ESHRE 2015 y de guías australianas; confirmar la redacción de ESHRE 2024
- **Pendiente:** La densitometría al diagnóstico de IOP se atribuyó a FEBRASGO 2020; verificar si ESHRE 2024 dice lo mismo
- **Pendiente:** NICE NG23 pudo haber tenido una actualización en abril de 2026; la guía la cita como actualizada en 2024
- **Pendiente:** La lista de contraindicaciones de la terapia sistémica viene de resúmenes secundarios de NAMS 2022
- **Pendiente:** NAMS 2022 usa 'o' en el texto y 'y' en los puntos destacados para el criterio de menores de 60 años / menos de 10 años desde la menopausia
- **Pendiente:** La afirmación de que los riesgos descritos en mujeres mayores no se trasladan a la IOP se apoya en una revisión, no en el texto de ESHRE
- **Pendiente:** Confirmar si ACOG actualizó la opinión de 2018 sobre sangrado posmenopáusico y si sigue vigente la recomendación de no suspender rutinariamente a los 65
- **Pendiente:** Confirmar el registro INVIMA de fezolinetant y elinzanetant en Colombia
- **Pendiente:** No se encontró una guía de MinSalud específica sobre menopausia
- **Pendiente:** Revisar los códigos CIE-10 (N95.0–N95.9, E28.3)

## parto-pretermino
- **Nueva (2026-10-14):** redactada con búsqueda web; 24 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Dosis de carga y mantenimiento de nifedipino: las fuentes no coinciden (carga de 20 o de 30 mg; mantenimiento de 10–20 mg cada 4–6 h o de 20–40 mg cuatro veces al día). Se dejó 'según protocolo institucional'; Criterio de 4 contracciones en 20 min u 8 en 60 min, y borramiento ≥80 %: solo aparece en un resumen del PB 127, la versión anterior; Profilaxis para estreptococo del grupo B con estado desconocido si la RPM dura ≥18 h o hay fiebre ≥38 °C: una sola fuente secundaria; se retiró del texto por extensión; NICE: corticoides entre 24+0 y 33+6 (ofrecer) y entre 34+0 y 35+6 (considerar): no se verificó; NICE: manejo con criterio clínico por debajo de 29+6 semanas: no se encontró en ninguna fuente; NICE: continuar la progesterona hasta al menos 34+0 semanas: no se encontró; Incidencia de prematurez en Colombia del 10,7 % en 2021: una sola fuente secundaria; Dosis de atosibán, vancomicina y clindamicina para alergia con alto riesgo de anafilaxia; Número y código de la Resolución 3280 de 2018 y código Sivigila de mortalidad perinatal: no se verificaron y no se citan; Umbral de remisión «antes de 34 semanas»: era una síntesis de las ventanas de tocólisis y corticoides, no una cifra de una fuente; el texto remite según la edad gestacional y la red materno perinatal.
- **Pendiente:** Confirmar la vigencia de ACOG PB 171 (2016) y CO 713 (2017): ACOG pudo actualizar los corticoides en el pretérmino tardío y en las 22–23 semanas
- **Pendiente:** Umbral de cérvix corto para progesterona vaginal según ACOG: ≤20 mm a ≤24 semanas (2012) o <25 mm a las 18–22 semanas (una fuente atribuye este último a la actualización de 2021)
- **Pendiente:** Caproato de 17-hidroxiprogesterona: la FDA retiró su aprobación en EE. UU.; verificar si está disponible en Colombia (INVIMA) antes de mantenerlo como opción de FIGO
- **Pendiente:** Si la recomendación de la OMS 2022 incluye tocólisis de mantenimiento con nifedipino, lo que contrasta con ACOG
- **Pendiente:** Recomendaciones concretas de la GPC MinSalud 2013 sobre amenaza de parto pretérmino y de la sección de RPM de 2015 (tocolítico preferido, esquema de antibióticos): no se pudo leer el texto
- **Pendiente:** Azitromicina en RPM: dosis única de 1 g o esquema de 500 mg seguido de 250 mg diarios
- **Pendiente:** Betametasona en el pretérmino tardío: exclusión de la diabetes pregestacional y vigilancia de hipoglucemia neonatal
- **Pendiente:** Monitoría del sulfato de magnesio (FIGO: al menos cada 4 h) y precaución al combinarlo con nifedipino

## sangrado-uterino-anormal
- **Nueva (2026-10-14):** redactada con búsqueda web; 20 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Ácido tranexámico: dosis máxima de 4 g al día (BNF), no se encontró; Umbrales de creatinina para ajustar el ácido tranexámico (1,4 / 2,8 / 5,7 mg/dL): las fuentes difieren en el primer corte, así que en el texto solo dice 'según la creatinina'; Noretisterona 5 mg tres veces al día del día 5 al 26: no figura en formularios y uno la considera ineficaz en dosis baja; Hasta 13 % de las mujeres con sangrado abundante tienen von Willebrand: solo una revisión, sin organismo; Frecuencias del tamizaje de coagulopatía (equimosis o epistaxis 1 a 2 veces al mes; más de 5 epistaxis al año); Adolescentes: 3 a 6 toallas al día y cambio cada 1 a 2 horas; SUA crónico definido como más de 6 meses; Volumen del balón de sonda Foley (30 a 50 mL) y tiempo de permanencia; Reducción de la pérdida sanguínea mayor del 90 % con el DIU de levonorgestrel; Puntos de corte del ISTH-BAT.
- **Pendiente:** FIGO 2018: confirmar en la fuente primaria que el sangrado por anticoagulantes pasó a la categoría iatrogénica (I); solo lo dice una fuente secundaria
- **Pendiente:** NICE NG88: el PDF oficial aparece actualizado en julio de 2026; revisar si cambió alguna recomendación respecto a 2018 y 2021
- **Pendiente:** Dosis de ACOG 2013 (medroxiprogesterona 20 mg, anticonceptivo de 35 µg tres veces al día, ácido tranexámico IV): verificadas en fuentes secundarias, no en la tabla original. Confirmar si hay estrógenos conjugados IV en Colombia
- **Pendiente:** Ácido tranexámico: diferencia entre el esquema del NHS (1 g) y el de la FDA (1 300 mg); revisar la presentación y la ficha INVIMA en Colombia y el ajuste renal
- **Pendiente:** Ácido mefenámico: solo un formulario lo respalda, y el de Irlanda del Norte lo excluye por toxicidad en sobredosis
- **Pendiente:** ACOG 2012 (biopsia como primera línea en mayores de 45 años): confirmar la redacción y la vigencia del boletín; NICE es más restrictiva
- **Pendiente:** Ferritina: NICE no la pide de rutina, ACOG 2019 sí la incluye en adolescentes; ver cómo encaja con la guía de anemia ferropénica
- **Pendiente:** No se encontró guía nacional de MinSalud; el Hospital Universitario Nacional de Colombia tiene un estándar institucional (2025) que podría revisarse

## artrosis
- **Nueva (2026-10-14):** redactada con búsqueda web; 6 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Beers 2023: evitar AINE con depuración de creatinina menor de 30 mL/min (no se encontró la tabla de función renal); Duración del alivio de la infiltración con corticoide de 2 a 10 semanas (una fuente dice 2-10 semanas y otra 2-4 semanas; no se confirmó la cifra de NG226); Intervalo mínimo de 3 meses o número máximo de infiltraciones de corticoide al año (ninguna guía revisada lo da); Remitir tras 3 meses de manejo conservador (solo aparece en políticas locales del NHS, no en NG226); Topes de IMC de 35 o 45 para remitir a cirugía (políticas locales del NHS que contradicen NICE); Dosis máxima diaria de acetaminofén en adultos mayores (no verificada); Duloxetina 60 mg/día como dosis de etiqueta FDA para dolor musculoesquelético crónico (no se confirmó la ficha técnica); Meta de pérdida de peso de 5-7,5 % (es de RACGP, que no es una guía citada).
- **Pendiente:** ACR 2026: solo se verificó por resúmenes secundarios (Epocrates, Healio, Guideline Central, OA Action Alliance). Hay que confirmar en el texto completo la cita, la dirección de la recomendación sobre acetaminofén, el estado del tramadol, los opioides y el ácido hialurónico, y si la condroitina en mano pasó a recomendación fuerte en contra
- **Pendiente:** ACR 2019, duloxetina: confirmar si la recomendación condicional abarca rodilla, cadera y mano o solo rodilla
- **Pendiente:** ACR 2019, infiltración de cadera: confirmar si la guía ecográfica es recomendación fuerte (en el texto solo se dice que se hace guiada por imagen)
- **Pendiente:** NICE NG226: confirmar la redacción exacta del AINE tópico en articulaciones distintas de la rodilla, de la gastroprotección con IBP, de la frase sobre el 10 % frente al 5 % de pérdida de peso y de los criterios de remisión para reemplazo (no condicionar la remisión a un puntaje ni al grado radiológico)
- **Pendiente:** EULAR 2023: solo se verificaron los temas de las recomendaciones 4 a 8 (peso, calzado, ayudas para la marcha, trabajo), no su texto
- **Pendiente:** Beers 2023: confirmar el umbral renal para los AINE y la redacción sobre el uso crónico
- **Pendiente:** Colombia: no se encontró ni se incluyó una GPC del MinSalud sobre artrosis; confirmar si existe

## otitis-externa
- **Nueva (2026-10-14):** redactada con búsqueda web; 18 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Alcance de la guía AAO-HNSF 2014 limitado a pacientes de 2 años o más (solo se encontró para 2006); Frecuencia y duración del clotrimazol: cada 8 a 12 horas hasta 14 días después de la curación, frente a 3 o 4 veces al día por 10 a 14 días (las fuentes no coinciden); Mejoría del dolor esperada a las 48 a 72 horas y resolución a los 7 días; Tasas de curación clínica del 65 al 90 % con gotas; Recomendación de AAO-HNSF contra las gotas anestésicas tópicas; Opioides por corto tiempo para el dolor intenso; Ciprofloxacino 0,2 % con hidrocortisona 1 %: 3 gotas cada 12 horas; Mortalidad de la otitis externa necrotizante de alrededor del 20 % (revisión antigua); Duración del curso de antibiótico en la otitis externa necrotizante de 6 a 8 semanas o de 4 a 8 semanas (se dejó 'al menos 6 semanas'); Incidencia de 1 de cada 123 personas al año y hasta el 10 % a lo largo de la vida; Evitar la irrigación del conducto en diabéticos; Venta libre del ácido acético al 2 % a partir de los 12 años.
- **Pendiente:** Contrastar con el texto completo de AAO-HNSF 2014 la duración de 7 + 7 días (tomada del material para pacientes de AAO-HNSF y de Cochrane 2010) y la lista de factores que modifican el manejo
- **Pendiente:** Dosis de neomicina, polimixina B e hidrocortisona verificadas en la monografía de Mayo Clinic y no en una ficha técnica del INVIMA; confirmar con el producto disponible en Colombia
- **Pendiente:** Flucloxacilina 500 mg cada 6 horas viene de formularios regionales escoceses, que no coinciden en la duración (5 frente a 7 días); en Colombia la flucloxacilina es poco usada, así que hay que definir el equivalente local
- **Pendiente:** Confirmar el año (2025) y las recomendaciones de duración de la guía neerlandesa NVKNO sobre otitis externa necrotizante
- **Pendiente:** Revisar la guía ACORL 2024 para adaptar las presentaciones y recomendaciones al contexto colombiano; no se encontró guía específica de MinSalud
- **Pendiente:** Confirmar ante el INVIMA la disponibilidad en Colombia de ofloxacino ótico, ciprofloxacino con dexametasona y ácido acético al 2 %
- **Pendiente:** Confirmar el año de la revisión Cochrane CD004740 (citada como 2010)
- **Pendiente:** Duración y frecuencia del clotrimazol en la otomicosis según la ficha técnica local

## quemaduras
- **Nueva (2026-10-14):** redactada con búsqueda web; 19 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Edad de corte para la fórmula pediátrica de 3 mL/kg (12 frente a 14 años según la fuente); 4 mL/kg/% SCQ para quemadura eléctrica según ABLS (no encontré fuente); Meta de diuresis con mioglobinuria (75–100 mL/h, más de 100 mL/h o 1–2 mL/kg/h: las fuentes no coinciden); Duración del monitoreo cardiaco en quemadura eléctrica (6–8 h frente a 24 h); Morfina intravenosa 0,1 mg/kg (no encontré fuente); Porcentajes de Lund-Browder por edad (cabeza del lactante y miembros inferiores: las fuentes no coinciden); Tiempo de curación del espesor parcial profundo (más de 3 semanas) y de la quemadura epidérmica (3–6 días, una sola fuente); Umbrales británicos de remisión (2 % en niños, 3 % en adultos) y criterio ambulatorio de menos del 10 % en adultos y menos del 5 % en niños; Duración de la irrigación en quemaduras por álcali (más de 20 minutos); Vida media de la carboxihemoglobina con oxígeno al 100 %.
- **Pendiente:** Confirmar la referencia completa de la guía ABA 2023 de reanimación (volumen y páginas, J Burn Care Res, doi irad125) y si la dosis de 2 mL/kg/% cubre 24 o 48 horas
- **Pendiente:** Confirmar en el manual ABLS 2018: el corte de edad o peso para la fórmula pediátrica, la distribución horaria en niños y la meta de diuresis pediátrica
- **Pendiente:** La guía usa la lista clásica de criterios de remisión de la ABA; contrastarla con las Guidelines for Burn Patient Referral 2022, que tienen formato por niveles
- **Pendiente:** Revisar NICE CKS Burns and scalds directamente: intervalos de control, tiempo de enfriamiento (algunas hojas para pacientes dicen 30 minutos) y criterios ambulatorios
- **Pendiente:** Quemadura eléctrica: duración del monitoreo cardiaco y meta de diuresis con mioglobinuria según el protocolo institucional
- **Pendiente:** Ácido fluorhídrico: concentración del gel y riesgo de hipocalcemia sistémica según toxicología
- **Pendiente:** Intervalo de repetición del fentanilo intranasal (5–10 min en Australia Occidental frente a 30 min en Glasgow)
- **Pendiente:** No encontré una GPC colombiana de quemaduras del MinSalud; verificar si existe un protocolo nacional o de la red de unidades de quemados, y la ficha vigente del INS para los eventos 452 y 875, además de la ruta de notificación del maltrato infantil (ICBF)
- **Pendiente:** Redacción del refuerzo antitetánico: 5 años o más frente a más de 5 años en la tabla de los CDC

## tos-ferina
- **Nueva (2026-10-14):** redactada con búsqueda web; 26 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Proporción de lactantes menores de 1 año que se hospitalizan (CDC, '1 de cada 3' o 'la mitad'); OMS 2015: serie primaria desde las 6 semanas con intervalos de 4 a 8 semanas, completa a los 6 meses, refuerzo de 1 a 6 años y meta de cobertura del 90 % (solo se encontró el texto de 2010); Plazo de la investigación de campo del INS: 72 h en un acta local frente a 48 h en la circular de 2012; Eritromicina en adultos (2 g/día); Definición de caso probable del INS para mayores de 12 años; Saturación menor de 92 % como criterio de gravedad (un solo estudio); Umbral de leucocitos para leucorreducción o exanguinotransfusión; Profilaxis hasta 6 semanas en contactos de alto riesgo (Iowa); Casos INS 2025 (7 099 probables y 1 033 confirmados): verificados, pero retirados por espacio; OR de estenosis pilórica con azitromicina (8,26 y 2,98): verificados, pero no incluidos.
- **Pendiente:** La definición de caso probable del INS se tomó de un acta de un comité local de vigilancia de 2025; contrastarla con el protocolo vigente del INS
- **Pendiente:** Plazo de notificación: el comité local habla de súper inmediata y la circular de 2012 fija 24 h; confirmar el código y la periodicidad en el Sivigila
- **Pendiente:** Semana de Tdap en gestantes (26 o 20) y si MinSalud la indica en cada embarazo, como CDC/ACIP
- **Pendiente:** Si el esquema acortado (6 semanas, 3 y 4,5 meses) sigue vigente en 2026 y si el refuerzo de 18 meses es con pentavalente o DPT
- **Pendiente:** Dosis de claritromicina en niños: CDC usa 15 mg/kg/día y Oregon 20 mg/kg/día; tope de 1 g/día en niños
- **Pendiente:** Las dosis de CDC 2005 se tomaron de fuentes secundarias; cotejarlas con la página actual de CDC y con el Red Book 2024
- **Pendiente:** Reglas de regreso a clases: confirmar el texto del Red Book y si existe norma colombiana
- **Pendiente:** Los criterios de hospitalización se redactaron sin un listado formal de guía; contrastarlos con el Red Book o con la GPC de MinSalud que cita la Circular 011
- **Pendiente:** Si la profilaxis a todo contacto del hogar coincide con el protocolo del INS
- **Pendiente:** Código CIE-10 Z27.1 (vacuna DPT combinada)

## varicela-y-sarampion
- **Nueva (2026-10-14):** redactada con búsqueda web; 31 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** OMS 2014: cobertura de 80 % o más para introducir la vacuna de varicela (no encontrada; se quitó también la frase sobre desplazamiento de edad); Panencefalitis esclerosante subaguda de 7 a 10 años después del sarampión; Día de inicio del aislamiento del expuesto a varicela (día 8 o día 10: las fuentes no coinciden); Plazos de toma de muestra del protocolo INS (suero hasta 30 días; hisopado y orina 5 a 14 días): las fuentes son de otros países y no coinciden; Aciclovir profiláctico posexposición en gestante (desde el día 7; 4 o 5 veces al día): las fuentes no coinciden; Mortalidad de la neumonía varicelosa en gestantes (10 a 41 %): solo series antiguas, que no coinciden; 100 lesiones o más como factor de riesgo de neumonía en la gestante (una sola fuente); Segunda muestra de suero a las 2 a 4 semanas (una sola fuente estatal); OMS 2017: primera dosis a los 9 o a los 12 meses según la transmisión (solo se verificó la de 9 meses); Intervalo de 4 semanas entre vacunas vivas no aplicadas el mismo día (no se verificó en esta sesión); Edades de mayor riesgo en sarampión (menores de 5 y mayores de 20 años); Estado de Colombia como país libre de sarampión (información que no coincide entre fuentes).
- **Pendiente:** Dosis pediátrica de aciclovir IV: 500 mg/m² cada 8 horas (MHRA) o 20 mg/kg cada 8 horas en menores de 12 años (FDA); definir con la ficha INVIMA del producto disponible
- **Pendiente:** Aciclovir oral en adultos: 800 mg 4 veces al día (FDA) o 5 veces al día (guías británicas, gestante); contrastar con la Green-top 13 del RCOG
- **Pendiente:** Definición de caso sospechoso, muestras y plazos en el protocolo INS vigente (lineamientos 2026, Circular 04 de 2026); se usaron la Circular 0015 de 2015, la ficha de la SDS Bogotá y el informe INS 2023
- **Pendiente:** Indicación de vitamina A: si es para todo niño con sarampión o solo donde hay deficiencia o en hospitalizados; contrastar con la OMS y el Red Book vigente (no se consultó el documento primario de la OMS)
- **Pendiente:** Refuerzo de triple viral a los 18 meses: se verificó en prensa y en la Alcaldía de Bogotá; confirmar con el lineamiento PAI vigente
- **Pendiente:** Corte de riesgo de varicela congénita: semana 12 o semana 13
- **Pendiente:** Disponibilidad en Colombia (INVIMA) de VariZIG y de inmunoglobulina para sarampión
- **Pendiente:** Riesgo de panencefalitis con sarampión antes de los 2 años: solo fuente secundaria
- **Pendiente:** Asociación AINE y fascitis necrotizante en varicela: se basa en estudios pequeños; revisar la postura de la AAP
- **Pendiente:** CIE-10 P35.8 para la varicela congénita: verificar el código preferido en Colombia
- **Pendiente:** Duración del aislamiento del sarampión en inmunosuprimidos (se escribió 'más tiempo', sin cifra)

## Guías de la primera tanda (33)
Redactadas sin acceso a las fuentes primarias. Todas requieren revisión médica completa antes de llenar
`revisado_por`; prioridad: dosis pediátricas (antibióticos, IRA, EDA, fiebre sin foco), embarazo (control
prenatal, preeclampsia) y urgencias (sepsis, ACV, TEP).
