import * as React from 'react';
import {
    EventBus,
    PDFFindController,
    PDFLinkService,
    PDFRenderingQueue,
    PDFViewer
} from 'pdfjs-dist/web/pdf_viewer';
import PDFJS, {
    DocumentInitParameters,
    PDFDocumentProxy,
    PDFViewerOptions
} from "pdfjs-dist";
import {URLStr} from "polar-shared/src/util/Strings";
import {Logger} from 'polar-shared/src/logger/Logger';
import {Debouncers} from "polar-shared/src/util/Debouncers";
import {Callback1} from "polar-shared/src/util/Functions";
import {Finder} from "./Finders";
import {PDFFindControllers} from "./PDFFindControllers";
import {ProgressMessages} from "../../../web/js/ui/progress_bar/ProgressMessages";
import {ProgressTracker} from "polar-shared/src/util/ProgressTracker";
import {ScaleLevelTuple, PDFScaleLevelTuples} from "./PDFScaleLevels";
import {useComponentDidMount} from "../../../web/js/hooks/lifecycle";
import {IDocDescriptor, useDocViewerCallbacks} from "./DocViewerStore";

const log = Logger.create();

PDFJS.GlobalWorkerOptions.workerSrc = '../../../node_modules/pdfjs-dist/build/pdf.worker.js';

interface DocViewer {
    readonly eventBus: EventBus;
    readonly findController: PDFFindController;
    readonly viewer: PDFViewer;
    readonly linkService: PDFLinkService;
    readonly renderingQueue: PDFRenderingQueue;
    readonly containerElement: HTMLElement;
}

function createDocViewer(): DocViewer {

    const eventBus = new EventBus({dispatchToDOM: false});
    // TODO  this isn't actually exported..
    const renderingQueue = new PDFRenderingQueue();

    const linkService = new PDFLinkService({
        eventBus,
    });

    const findController = new PDFFindController({
        linkService,
        eventBus
    });

    const containerElement = document.getElementById('viewerContainer')! as HTMLDivElement;

    if (containerElement === null) {
        throw new Error("No containerElement");
    }

    const viewerElement = document.getElementById('viewer')! as HTMLDivElement;

    if (viewerElement === null) {
        throw new Error("No viewerElement");
    }

    const viewerOpts: PDFViewerOptions = {
        container: containerElement,
        viewer: viewerElement,
        textLayerMode: 2,
        linkService, 
        findController,
        eventBus,
        useOnlyCssZoom: false,
        enableWebGL: false,
        renderInteractiveForms: false,
        pdfBugEnabled: false,
        disableRange: false,
        disableStream: false,
        disableAutoFetch: false,
        disableFontFace: false,
        // renderer: "svg",
        // renderingQueue, // this isn't actually needed when its in a scroll container
        maxCanvasPixels: 16777216,
        enablePrintAutoRotate: false,
        // renderer: RendererType.SVG,
        // renderer: RenderType
        // removePageBorders: true,
        // defaultViewport: viewport
    };

    const viewer = new PDFViewer(viewerOpts);

    linkService.setViewer(viewer);
    renderingQueue.setViewer(viewer);

    (renderingQueue as any).onIdle = () => {
        viewer.cleanup();
    };

    return {eventBus, findController, viewer, linkService, renderingQueue, containerElement};

}

interface LoadedDoc {
    readonly doc: PDFJS.PDFDocumentProxy;
    readonly scale: number | string;
}

export type OnFinderCallback = Callback1<Finder>;

interface IProps {
    readonly target: string;
    readonly url: URLStr;
    readonly onFinder: OnFinderCallback;
}

interface IState {
    readonly loadedDoc?: LoadedDoc;
}

// FIXME: react.memo
export const PDFDocument = (props: IProps) => {

    const docViewerRef = React.useRef<DocViewer | undefined>(undefined);
    const scaleRef = React.useRef<ScaleLevelTuple>(PDFScaleLevelTuples[0]);
    const docRef = React.useRef<PDFDocumentProxy | undefined>(undefined);

    const {setDocDescriptor, setPageNavigator, setResizer, setScaleLeveler} = useDocViewerCallbacks();

    useComponentDidMount(() => {

        docViewerRef.current = createDocViewer();

        doLoad(docViewerRef.current)
            .catch(err => log.error("Could not load PDF: ", err));

    })

    const doLoad = async (docViewer: DocViewer) => {

        const {url} = props;

        const init: DocumentInitParameters = {
            url,
            cMapPacked: true,
            cMapUrl: '../../node_modules/pdfjs-dist/cmaps/',
            disableAutoFetch: true,
        };

        const loadingTask = PDFJS.getDocument(init);

        let progressTracker: ProgressTracker | undefined;
        loadingTask.onProgress = (progress) => {

            if (! progressTracker) {
                progressTracker = new ProgressTracker({
                    id: 'pdf-download',
                    total: progress.total
                });
            }

            if (progress.loaded > progress.total) {
                return;
            }

            ProgressMessages.broadcast(progressTracker!.abs(progress.loaded));

        };

        docRef.current = await loadingTask.promise;

        const page = await docRef.current.getPage(1);
        const viewport = page.getViewport({scale: 1.0});

        const calculateScale = (to: number, from: number) => {
            console.log(`Calculating scale from ${from} to ${to}...`);
            return to / from;
        };

        const scale = calculateScale(window.innerWidth, viewport.width);

        docViewer.viewer.setDocument(docRef.current);
        docViewer.linkService.setDocument(docRef.current, null);

        const finder = PDFFindControllers.createFinder(docViewer.eventBus,
                                                       docViewer.findController);

        props.onFinder(finder);

        docViewer.eventBus.on('pagesinit', () => {
            // PageContextMenus.start();
        });

        const resizeDebouncer = Debouncers.create(() => resize());

        window.addEventListener('resize', resizeDebouncer);

        document.getElementById("viewerContainer")!
            .addEventListener("resize", resizeDebouncer);

        setResizer(resizeDebouncer);

        // do first resize async
        setTimeout(() => resize(), 1 );

        const pdfPageNavigator: PDFPageNavigator = {
            get: () => docViewer.viewer.currentPageNumber,
            set: (page: number) => docViewer.viewer.currentPageNumber = page
        };

        dispatchPDFDocMeta();

        setPageNavigator(pdfPageNavigator);

        const scrollDebouncer = Debouncers.create(() => {
            dispatchPDFDocMeta();
        });

        docViewer.containerElement.addEventListener('scroll', () => {
            scrollDebouncer();
        });

        const scaleLeveler = (scale: ScaleLevelTuple) => {
            return setScale(scale);
        };

        setScaleLeveler(scaleLeveler);

    }

    function resize() {

        if (['page-width', 'page-fit'].includes(scaleRef.current.value)) {
            setScale(scaleRef.current);
        }

    }

    function setScale(scale: ScaleLevelTuple) {

        if (docViewerRef.current) {
            scaleRef.current = scale;
            docViewerRef.current.viewer.currentScaleValue = scale.value;

            dispatchPDFDocMeta();

            return docViewerRef.current.viewer.currentScale;

        }

        return -1;

    }

    function dispatchPDFDocMeta() {

        if (docRef.current && docViewerRef.current) {

            const docDescriptor: IDocDescriptor = {
                // title: docRef.current.title,
                // scale: scaleRef.current,
                // scaleValue: docViewerRef.current.viewer.currentScale,
                nrPages: docRef.current.numPages,
                fingerprint: docRef.current.fingerprint
            };

            setDocDescriptor(docDescriptor);

        }

    }

    return null;

}

export interface PDFPageNavigator {
    readonly get: () => number;
    readonly set: (page: number) => void;
}

