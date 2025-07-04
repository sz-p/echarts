/*
* Licensed to the Apache Software Foundation (ASF) under one
* or more contributor license agreements.  See the NOTICE file
* distributed with this work for additional information
* regarding copyright ownership.  The ASF licenses this file
* to you under the Apache License, Version 2.0 (the
* "License"); you may not use this file except in compliance
* with the License.  You may obtain a copy of the License at
*
*   http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing,
* software distributed under the License is distributed on an
* "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
* KIND, either express or implied.  See the License for the
* specific language governing permissions and limitations
* under the License.
*/

import { bind, each, isFunction, isString, indexOf } from 'zrender/src/core/util';
import * as eventTool from 'zrender/src/core/event';
import * as graphic from '../../util/graphic';
import * as throttle from '../../util/throttle';
import DataZoomView from './DataZoomView';
import { linearMap, asc, parsePercent } from '../../util/number';
import * as layout from '../../util/layout';
import sliderMove from '../helper/sliderMove';
import GlobalModel from '../../model/Global';
import ExtensionAPI from '../../core/ExtensionAPI';
import {
    LayoutOrient, Payload, ZRTextVerticalAlign, ZRTextAlign, ZRElementEvent, ParsedValue
} from '../../util/types';
import SliderZoomModel from './SliderZoomModel';
import { RectLike } from 'zrender/src/core/BoundingRect';
import Axis from '../../coord/Axis';
import SeriesModel from '../../model/Series';
import { AxisBaseModel } from '../../coord/AxisBaseModel';
import { getAxisMainType, collectReferCoordSysModelInfo } from './helper';
import { enableHoverEmphasis } from '../../util/states';
import { createSymbol, symbolBuildProxies } from '../../util/symbol';
import { deprecateLog } from '../../util/log';
import { PointLike } from 'zrender/src/core/Point';
import Displayable from 'zrender/src/graphic/Displayable';
import { createTextStyle } from '../../label/labelStyle';
import SeriesData from '../../data/SeriesData';
import tokens from '../../visual/tokens';
import { addEditorInfo } from '../../util/editorInfo';

const Rect = graphic.Rect;

// Constants
const DEFAULT_FRAME_BORDER_WIDTH = 1;
const DEFAULT_FILLER_SIZE = 30;
const DEFAULT_MOVE_HANDLE_SIZE = 7;
const HORIZONTAL = 'horizontal';
const VERTICAL = 'vertical';
const LABEL_GAP = 5;
const SHOW_DATA_SHADOW_SERIES_TYPE = ['line', 'bar', 'candlestick', 'scatter'];

const REALTIME_ANIMATION_CONFIG = {
    easing: 'cubicOut',
    duration: 100,
    delay: 0
} as const;

// const NORMAL_ANIMATION_CONFIG = {
//     easing: 'cubicInOut',
//     duration: 200
// } as const;


interface Displayables {
    sliderGroup: graphic.Group;
    handles: [graphic.Path, graphic.Path];
    handleLabels: [graphic.Text, graphic.Text];
    dataShadowSegs: graphic.Group[];
    filler: graphic.Rect;

    brushRect: graphic.Rect;

    moveHandle: graphic.Rect;
    moveHandleIcon: graphic.Path;
    // invisible move zone.
    moveZone: graphic.Rect;
}
class SliderZoomView extends DataZoomView {
    static type = 'dataZoom.slider';
    type = SliderZoomView.type;

    dataZoomModel: SliderZoomModel;

    private _displayables = {} as Displayables;

    private _orient: LayoutOrient;

    private _range: number[];

    /**
     * [coord of the first handle, coord of the second handle]
     */
    private _handleEnds: number[];

    /**
     * [length, thick]
     */
    private _size: number[];

    private _handleWidth: number;

    private _handleHeight: number;

    private _location: PointLike;

    private _brushStart: PointLike;
    private _brushStartTime: number;

    private _dragging: boolean;

    private _brushing: boolean;

    private _dataShadowInfo: {
        thisAxis: Axis
        series: SeriesModel
        thisDim: string
        otherDim: string
        otherAxisInverse: boolean
    };

    // Cached raw data. Avoid rendering data shadow multiple times.
    private _shadowData: SeriesData;
    private _shadowDim: string;
    private _shadowSize: number[];
    private _shadowPolygonPts: number[][];
    private _shadowPolylinePts: number[][];

    init(ecModel: GlobalModel, api: ExtensionAPI) {
        this.api = api;

        // A unique handler for each dataZoom component
        this._onBrush = bind(this._onBrush, this);
        this._onBrushEnd = bind(this._onBrushEnd, this);
    }

    render(
        dataZoomModel: SliderZoomModel,
        ecModel: GlobalModel,
        api: ExtensionAPI,
        payload: Payload & {
            from: string
            type: string
        }
    ) {
        super.render.apply(this, arguments as any);

        throttle.createOrUpdate(
            this,
            '_dispatchZoomAction',
            dataZoomModel.get('throttle'),
            'fixRate'
        );

        this._orient = dataZoomModel.getOrient();

        if (dataZoomModel.get('show') === false) {
            this.group.removeAll();
            return;
        }

        if (dataZoomModel.noTarget()) {
            this._clear();
            this.group.removeAll();
            return;
        }

        // Notice: this._resetInterval() should not be executed when payload.type
        // is 'dataZoom', origin this._range should be maintained, otherwise 'pan'
        // or 'zoom' info will be missed because of 'throttle' of this.dispatchAction,
        if (!payload || payload.type !== 'dataZoom' || payload.from !== this.uid) {
            this._buildView();
        }

        this._updateView();
    }

    dispose() {
        this._clear();
        super.dispose.apply(this, arguments as any);
    }

    private _clear() {
        throttle.clear(this, '_dispatchZoomAction');

        const zr = this.api.getZr();
        zr.off('mousemove', this._onBrush);
        zr.off('mouseup', this._onBrushEnd);
    }

    private _buildView() {
        const thisGroup = this.group;

        thisGroup.removeAll();

        this._brushing = false;
        this._displayables.brushRect = null;

        this._resetLocation();
        this._resetInterval();

        const barGroup = this._displayables.sliderGroup = new graphic.Group();

        this._renderBackground();

        this._renderHandle();

        this._renderDataShadow();

        thisGroup.add(barGroup);

        this._positionGroup();
    }

    private _resetLocation() {
        const dataZoomModel = this.dataZoomModel;
        const api = this.api;
        const showMoveHandle = dataZoomModel.get('brushSelect');
        const moveHandleSize = showMoveHandle ? DEFAULT_MOVE_HANDLE_SIZE : 0;

        // If some of x/y/width/height are not specified,
        // auto-adapt according to target grid.
        const coordRect = this._findCoordRect();
        const ecSize = { width: api.getWidth(), height: api.getHeight() };
        const edgeGap = dataZoomModel.get('defaultLocationEdgeGap', true) || 0;
        // Default align by coordinate system rect.
        const positionInfo = this._orient === HORIZONTAL
            ? {
                // Why using 'right', because right should be used in vertical,
                // and it is better to be consistent for dealing with position param merge.
                right: ecSize.width - coordRect.x - coordRect.width,
                top: (ecSize.height - DEFAULT_FILLER_SIZE - edgeGap - moveHandleSize),
                width: coordRect.width,
                height: DEFAULT_FILLER_SIZE
            }
            : { // vertical
                right: edgeGap,
                top: coordRect.y,
                width: DEFAULT_FILLER_SIZE,
                height: coordRect.height
            };

        // Do not write back to option and replace value 'ph', because
        // the 'ph' value should be recalculated when resize.
        const layoutParams = layout.getLayoutParams(dataZoomModel.option);

        // Replace the placeholder value.
        each(['right', 'top', 'width', 'height'] as const, function (name) {
            if (layoutParams[name] === 'ph') {
                layoutParams[name] = positionInfo[name];
            }
        });

        const layoutRect = layout.getLayoutRect(
            layoutParams,
            ecSize
        );

        this._location = { x: layoutRect.x, y: layoutRect.y };
        this._size = [layoutRect.width, layoutRect.height];
        this._orient === VERTICAL && this._size.reverse();
    }

    private _positionGroup() {
        const thisGroup = this.group;
        const location = this._location;
        const orient = this._orient;

        // Just use the first axis to determine mapping.
        const targetAxisModel = this.dataZoomModel.getFirstTargetAxisModel();
        const inverse = targetAxisModel && targetAxisModel.get('inverse');

        const sliderGroup = this._displayables.sliderGroup;
        const otherAxisInverse = (this._dataShadowInfo || {}).otherAxisInverse;

        // Transform barGroup.
        sliderGroup.attr(
            (orient === HORIZONTAL && !inverse)
            ? {scaleY: otherAxisInverse ? 1 : -1, scaleX: 1 }
            : (orient === HORIZONTAL && inverse)
            ? {scaleY: otherAxisInverse ? 1 : -1, scaleX: -1 }
            : (orient === VERTICAL && !inverse)
            ? {scaleY: otherAxisInverse ? -1 : 1, scaleX: 1, rotation: Math.PI / 2}
            // Don't use Math.PI, considering shadow direction.
            : {scaleY: otherAxisInverse ? -1 : 1, scaleX: -1, rotation: Math.PI / 2}
        );

        // Position barGroup
        const rect = thisGroup.getBoundingRect([sliderGroup]);
        thisGroup.x = location.x - rect.x;
        thisGroup.y = location.y - rect.y;
        thisGroup.markRedraw();
    }

    private _getViewExtent() {
        return [0, this._size[0]];
    }

    private _renderBackground() {
        const dataZoomModel = this.dataZoomModel;
        const size = this._size;
        const barGroup = this._displayables.sliderGroup;
        const brushSelect = dataZoomModel.get('brushSelect');

        const backgroundRect = new Rect({
            silent: true,
            shape: {
                x: 0, y: 0, width: size[0], height: size[1]
            },
            style: {
                fill: dataZoomModel.get('backgroundColor')
            },
            z2: -40
        });
        if (__EDITOR__) {
            addEditorInfo(backgroundRect, {
                component: 'dataZoom',
                element: 'backgroundRect'
            });
        }
        barGroup.add(backgroundRect);

        // Click panel, over shadow, below handles.
        const clickPanel = new Rect({
            shape: {
                x: 0, y: 0, width: size[0], height: size[1]
            },
            style: {
                fill: 'transparent'
            },
            z2: 0,
            onclick: bind(this._onClickPanel, this)
        });

        if (__EDITOR__) {
            addEditorInfo(clickPanel, {
                component: 'dataZoom',
                element: 'clickPanel'
            });
        }
        const zr = this.api.getZr();
        if (brushSelect) {
            clickPanel.on('mousedown', this._onBrushStart, this);
            clickPanel.cursor = 'crosshair';

            zr.on('mousemove', this._onBrush);
            zr.on('mouseup', this._onBrushEnd);
        }
        else {
            zr.off('mousemove', this._onBrush);
            zr.off('mouseup', this._onBrushEnd);
        }

        barGroup.add(clickPanel);
    }

    private _renderDataShadow() {
        const info = this._dataShadowInfo = this._prepareDataShadowInfo();

        this._displayables.dataShadowSegs = [];

        if (!info) {
            return;
        }

        const size = this._size;
        const oldSize = this._shadowSize || [];
        const seriesModel = info.series;
        const data = seriesModel.getRawData();
        const candlestickDim = seriesModel.getShadowDim && seriesModel.getShadowDim();
        const otherDim: string = candlestickDim && data.getDimensionInfo(candlestickDim)
            ? seriesModel.getShadowDim() // @see candlestick
            : info.otherDim;

        if (otherDim == null) {
            return;
        }

        let polygonPts = this._shadowPolygonPts;
        let polylinePts = this._shadowPolylinePts;
        // Not re-render if data doesn't change.
        if (
            data !== this._shadowData || otherDim !== this._shadowDim
            || size[0] !== oldSize[0] || size[1] !== oldSize[1]
        ) {
            const thisDataExtent = data.getDataExtent(info.thisDim);
            let otherDataExtent = data.getDataExtent(otherDim);
            // Nice extent.
            const otherOffset = (otherDataExtent[1] - otherDataExtent[0]) * 0.3;
            otherDataExtent = [
                otherDataExtent[0] - otherOffset,
                otherDataExtent[1] + otherOffset
            ];
            const otherShadowExtent = [0, size[1]];
            const thisShadowExtent = [0, size[0]];

            const areaPoints = [[size[0], 0], [0, 0]];
            const linePoints: number[][] = [];
            const step = thisShadowExtent[1] / (Math.max(1, data.count() - 1));
            const normalizationConstant = size[0] / (thisDataExtent[1] - thisDataExtent[0]);
            const isTimeAxis = info.thisAxis.type === 'time';
            let thisCoord = -step;

            // Optimize for large data shadow
            const stride = Math.round(data.count() / size[0]);
            let lastIsEmpty: boolean;

            data.each([info.thisDim, otherDim], function (thisValue: ParsedValue, otherValue: ParsedValue, index) {
                if (stride > 0 && (index % stride)) {
                    if (!isTimeAxis) {
                        thisCoord += step;
                    }
                    return;
                }

                thisCoord = isTimeAxis
                    ? (+thisValue - thisDataExtent[0]) * normalizationConstant
                    : thisCoord + step;

                // FIXME
                // Should consider axis.min/axis.max when drawing dataShadow.

                // FIXME
                // 应该使用统一的空判断？还是在list里进行空判断？
                const isEmpty = otherValue == null || isNaN(otherValue as number) || otherValue === '';
                // See #4235.
                const otherCoord = isEmpty
                    ? 0 : linearMap(otherValue as number, otherDataExtent, otherShadowExtent, true);

                // Attempt to draw data shadow precisely when there are empty value.
                if (isEmpty && !lastIsEmpty && index) {
                    areaPoints.push([areaPoints[areaPoints.length - 1][0], 0]);
                    linePoints.push([linePoints[linePoints.length - 1][0], 0]);
                }
                else if (!isEmpty && lastIsEmpty) {
                    areaPoints.push([thisCoord, 0]);
                    linePoints.push([thisCoord, 0]);
                }

                areaPoints.push([thisCoord, otherCoord]);
                linePoints.push([thisCoord, otherCoord]);

                lastIsEmpty = isEmpty;
            });

            polygonPts = this._shadowPolygonPts = areaPoints;
            polylinePts = this._shadowPolylinePts = linePoints;

        }
        this._shadowData = data;
        this._shadowDim = otherDim;
        this._shadowSize = [size[0], size[1]];

        const dataZoomModel = this.dataZoomModel;

        function createDataShadowGroup(isSelectedArea?: boolean) {
            const model = dataZoomModel.getModel(isSelectedArea ? 'selectedDataBackground' : 'dataBackground');
            const group = new graphic.Group();
            const polygon = new graphic.Polygon({
                shape: { points: polygonPts },
                segmentIgnoreThreshold: 1,
                style: model.getModel('areaStyle').getAreaStyle(),
                silent: true,
                z2: -20
            });
            const polyline = new graphic.Polyline({
                shape: { points: polylinePts },
                segmentIgnoreThreshold: 1,
                style: model.getModel('lineStyle').getLineStyle(),
                silent: true,
                z2: -19
            });
            if (__EDITOR__) {
                addEditorInfo(polygon, {
                    component: 'dataZoom',
                    element: 'polygon'
                });
                addEditorInfo(polyline, {
                    component: 'dataZoom',
                    element: 'polyline'
                });
            }
            group.add(polygon);
            group.add(polyline);
            return group;
        }

        // let dataBackgroundModel = dataZoomModel.getModel('dataBackground');
        for (let i = 0; i < 3; i++) {
            const group = createDataShadowGroup(i === 1);
            this._displayables.sliderGroup.add(group);
            this._displayables.dataShadowSegs.push(group);
        }
    }

    private _prepareDataShadowInfo() {
        const dataZoomModel = this.dataZoomModel;
        const showDataShadow = dataZoomModel.get('showDataShadow');

        if (showDataShadow === false) {
            return;
        }

        // Find a representative series.
        let result: SliderZoomView['_dataShadowInfo'];
        const ecModel = this.ecModel;

        dataZoomModel.eachTargetAxis(function (axisDim, axisIndex) {
            const seriesModels = dataZoomModel
                .getAxisProxy(axisDim, axisIndex)
                .getTargetSeriesModels();

            each(seriesModels, function (seriesModel) {
                if (result) {
                    return;
                }

                if (showDataShadow !== true && indexOf(
                    SHOW_DATA_SHADOW_SERIES_TYPE, seriesModel.get('type')
                ) < 0
                ) {
                    return;
                }

                const thisAxis = (
                    ecModel.getComponent(getAxisMainType(axisDim), axisIndex) as AxisBaseModel
                ).axis;
                let otherDim = getOtherDim(axisDim);
                let otherAxisInverse;
                const coordSys = seriesModel.coordinateSystem;

                if (otherDim != null && coordSys.getOtherAxis) {
                    otherAxisInverse = coordSys.getOtherAxis(thisAxis).inverse;
                }

                otherDim = seriesModel.getData().mapDimension(otherDim);
                const thisDim = seriesModel.getData().mapDimension(axisDim);

                result = {
                    thisAxis: thisAxis,
                    series: seriesModel,
                    thisDim: thisDim,
                    otherDim: otherDim,
                    otherAxisInverse: otherAxisInverse
                };

            }, this);

        }, this);

        return result;
    }

    private _renderHandle() {
        const thisGroup = this.group;
        const displayables = this._displayables;
        const handles: [graphic.Path, graphic.Path] = displayables.handles = [null, null];
        const handleLabels: [graphic.Text, graphic.Text] = displayables.handleLabels = [null, null];
        const sliderGroup = this._displayables.sliderGroup;
        const size = this._size;
        const dataZoomModel = this.dataZoomModel;
        const api = this.api;

        const borderRadius = dataZoomModel.get('borderRadius') || 0;

        const brushSelect = dataZoomModel.get('brushSelect');

        const filler = displayables.filler = new Rect({
            silent: brushSelect,
            style: {
                fill: dataZoomModel.get('fillerColor')
            },
            textConfig: {
                position: 'inside'
            }
        });

        if (__EDITOR__) {
            addEditorInfo(filler, {
                component: 'dataZoom',
                element: 'filler'
            });
        }
        sliderGroup.add(filler);

        // Frame border.
        const frameBorder = new Rect({
            silent: true,
            subPixelOptimize: true,
            shape: {
                x: 0,
                y: 0,
                width: size[0],
                height: size[1],
                r: borderRadius
            },
            style: {
                // deprecated option
                stroke: dataZoomModel.get('dataBackgroundColor' as any)
                    || dataZoomModel.get('borderColor'),
                lineWidth: DEFAULT_FRAME_BORDER_WIDTH,
                fill: tokens.color.transparent
            }
        });
        if (__EDITOR__) {
            addEditorInfo(frameBorder, {
                component: 'dataZoom',
                element: 'fillerBackground'
            });
        }
        sliderGroup.add(frameBorder);

        // Left and right handle to resize
        each([0, 1] as const, function (handleIndex) {
            let iconStr = dataZoomModel.get('handleIcon');
            if (
                !symbolBuildProxies[iconStr]
                && iconStr.indexOf('path://') < 0
                && iconStr.indexOf('image://') < 0
            ) {
                // Compatitable with the old icon parsers. Which can use a path string without path://
                iconStr = 'path://' + iconStr;
                if (__DEV__) {
                    deprecateLog('handleIcon now needs \'path://\' prefix when using a path string');
                }
            }
            const path = createSymbol(
                iconStr,
                -1, 0, 2, 2, null, true
            ) as graphic.Path;
            if (__EDITOR__) {
                addEditorInfo(path, {
                    component: 'dataZoom',
                    element: 'handle'
                });
            }
            path.attr({
                cursor: getCursor(this._orient),
                draggable: true,
                drift: bind(this._onDragMove, this, handleIndex),
                ondragend: bind(this._onDragEnd, this),
                onmouseover: bind(this._showDataInfo, this, true),
                onmouseout: bind(this._showDataInfo, this, false),
                z2: 5
            });

            const bRect = path.getBoundingRect();
            const handleSize = dataZoomModel.get('handleSize');

            this._handleHeight = parsePercent(handleSize, this._size[1]);
            this._handleWidth = bRect.width / bRect.height * this._handleHeight;

            path.setStyle(dataZoomModel.getModel('handleStyle').getItemStyle());
            path.style.strokeNoScale = true;
            path.rectHover = true;

            path.ensureState('emphasis').style = dataZoomModel.getModel(['emphasis', 'handleStyle']).getItemStyle();
            enableHoverEmphasis(path);

            const handleColor = dataZoomModel.get('handleColor' as any); // deprecated option
            // Compatitable with previous version
            if (handleColor != null) {
                path.style.fill = handleColor;
            }

            sliderGroup.add(handles[handleIndex] = path);

            const textStyleModel = dataZoomModel.getModel('textStyle');
            const handleLabel = dataZoomModel.get('handleLabel') || {};
            const handleLabelShow = handleLabel.show || false;

            handleLabels[handleIndex] = new graphic.Text({
                silent: true,
                invisible: !handleLabelShow,
                style: createTextStyle(textStyleModel, {
                    x: 0, y: 0, text: '',
                    verticalAlign: 'middle',
                    align: 'center',
                    fill: textStyleModel.getTextColor(),
                    font: textStyleModel.getFont()
                }),
                z2: 10
            });
            if (__EDITOR__) {
                addEditorInfo(handleLabels[handleIndex], {
                    component: 'dataZoom',
                    element: 'handleLabel'
                });
            }
            thisGroup.add(handleLabels[handleIndex]);

        }, this);

        // Handle to move. Only visible when brushSelect is set true.
        let actualMoveZone: Displayable = filler;
        if (brushSelect) {
            const moveHandleHeight = parsePercent(dataZoomModel.get('moveHandleSize'), size[1]);
            const moveHandle = displayables.moveHandle = new graphic.Rect({
                style: dataZoomModel.getModel('moveHandleStyle').getItemStyle(),
                silent: true,
                shape: {
                    r: [0, 0, 2, 2],
                    y: size[1] - 0.5,
                    height: moveHandleHeight
                }
            });
            const iconSize = moveHandleHeight * 0.8;
            const moveHandleIcon = displayables.moveHandleIcon = createSymbol(
                dataZoomModel.get('moveHandleIcon'),
                -iconSize / 2, -iconSize / 2, iconSize, iconSize,
                tokens.color.neutral00,
                true
            );
            moveHandleIcon.silent = true;
            moveHandleIcon.y = size[1] + moveHandleHeight / 2 - 0.5;

            moveHandle.ensureState('emphasis').style = dataZoomModel.getModel(
                ['emphasis', 'moveHandleStyle']
            ).getItemStyle();

            const moveZoneExpandSize = Math.min(size[1] / 2, Math.max(moveHandleHeight, 10));
            actualMoveZone = displayables.moveZone = new graphic.Rect({
                invisible: true,
                shape: {
                    y: size[1] - moveZoneExpandSize,
                    height: moveHandleHeight + moveZoneExpandSize
                }
            });

            actualMoveZone.on('mouseover', () => {
                api.enterEmphasis(moveHandle);
            })
                .on('mouseout', () => {
                    api.leaveEmphasis(moveHandle);
                });

            if (__EDITOR__) {
                addEditorInfo(moveHandle, {
                    component: 'dataZoom',
                    element: 'moveHandle'
                });
                addEditorInfo(moveHandleIcon, {
                    component: 'dataZoom',
                    element: 'moveHandleIcon'
                });
                addEditorInfo(actualMoveZone, {
                    component: 'dataZoom',
                    element: 'actualMoveZone'
                });
            }
            sliderGroup.add(moveHandle);
            sliderGroup.add(moveHandleIcon);
            sliderGroup.add(actualMoveZone);
        }

        actualMoveZone.attr({
            draggable: true,
            cursor: 'default',
            drift: bind(this._onDragMove, this, 'all'),
            ondragstart: bind(this._showDataInfo, this, true),
            ondragend: bind(this._onDragEnd, this),
            onmouseover: bind(this._showDataInfo, this, true),
            onmouseout: bind(this._showDataInfo, this, false)
        });
    }

    private _resetInterval() {
        const range = this._range = this.dataZoomModel.getPercentRange();
        const viewExtent = this._getViewExtent();

        this._handleEnds = [
            linearMap(range[0], [0, 100], viewExtent, true),
            linearMap(range[1], [0, 100], viewExtent, true)
        ];
    }

    private _updateInterval(handleIndex: 0 | 1 | 'all', delta: number): boolean {
        const dataZoomModel = this.dataZoomModel;
        const handleEnds = this._handleEnds;
        const viewExtend = this._getViewExtent();
        const minMaxSpan = dataZoomModel.findRepresentativeAxisProxy().getMinMaxSpan();
        const percentExtent = [0, 100];

        sliderMove(
            delta,
            handleEnds,
            viewExtend,
            dataZoomModel.get('zoomLock') ? 'all' : handleIndex,
            minMaxSpan.minSpan != null
                ? linearMap(minMaxSpan.minSpan, percentExtent, viewExtend, true) : null,
            minMaxSpan.maxSpan != null
                ? linearMap(minMaxSpan.maxSpan, percentExtent, viewExtend, true) : null
        );

        const lastRange = this._range;
        const range = this._range = asc([
            linearMap(handleEnds[0], viewExtend, percentExtent, true),
            linearMap(handleEnds[1], viewExtend, percentExtent, true)
        ]);

        return !lastRange || lastRange[0] !== range[0] || lastRange[1] !== range[1];
    }

    private _updateView(nonRealtime?: boolean) {
        const displaybles = this._displayables;
        const handleEnds = this._handleEnds;
        const handleInterval = asc(handleEnds.slice());
        const size = this._size;

        each([0, 1] as const, function (handleIndex) {
            // Handles
            const handle = displaybles.handles[handleIndex];
            const handleHeight = this._handleHeight;
            (handle as graphic.Path).attr({
                scaleX: handleHeight / 2,
                scaleY: handleHeight / 2,
                // This is a trick, by adding an extra tiny offset to let the default handle's end point align to the drag window.
                // NOTE: It may affect some custom shapes a bit. But we prefer to have better result by default.
                x: handleEnds[handleIndex] + (handleIndex ? -1 : 1),
                y: size[1] / 2 - handleHeight / 2
            });
        }, this);

        // Filler
        displaybles.filler.setShape({
            x: handleInterval[0],
            y: 0,
            width: handleInterval[1] - handleInterval[0],
            height: size[1]
        });

        const viewExtent = {
            x: handleInterval[0],
            width: handleInterval[1] - handleInterval[0]
        };
        // Move handle
        if (displaybles.moveHandle) {
            displaybles.moveHandle.setShape(viewExtent);
            displaybles.moveZone.setShape(viewExtent);
            // Force update path on the invisible object
            displaybles.moveZone.getBoundingRect();
            displaybles.moveHandleIcon && displaybles.moveHandleIcon.attr('x', viewExtent.x + viewExtent.width / 2);
        }

        // update clip path of shadow.
        const dataShadowSegs = displaybles.dataShadowSegs;
        const segIntervals = [0, handleInterval[0], handleInterval[1], size[0]];

        for (let i = 0; i < dataShadowSegs.length; i++) {
            const segGroup = dataShadowSegs[i];
            let clipPath = segGroup.getClipPath();
            if (!clipPath) {
                clipPath = new graphic.Rect();
                segGroup.setClipPath(clipPath);
            }
            clipPath.setShape({
                x: segIntervals[i],
                y: 0,
                width: segIntervals[i + 1] - segIntervals[i],
                height: size[1]
            });
        }

        this._updateDataInfo(nonRealtime);
    }

    private _updateDataInfo(nonRealtime?: boolean) {
        const dataZoomModel = this.dataZoomModel;
        const displaybles = this._displayables;
        const handleLabels = displaybles.handleLabels;
        const orient = this._orient;
        let labelTexts = ['', ''];

        // FIXME
        // date型，支持formatter，autoformatter（ec2 date.getAutoFormatter）
        if (dataZoomModel.get('showDetail')) {
            const axisProxy = dataZoomModel.findRepresentativeAxisProxy();

            if (axisProxy) {
                const axis = axisProxy.getAxisModel().axis;
                const range = this._range;

                const dataInterval = nonRealtime
                    // See #4434, data and axis are not processed and reset yet in non-realtime mode.
                    ? axisProxy.calculateDataWindow({
                        start: range[0], end: range[1]
                    }).valueWindow
                    : axisProxy.getDataValueWindow();

                labelTexts = [
                    this._formatLabel(dataInterval[0], axis),
                    this._formatLabel(dataInterval[1], axis)
                ];
            }
        }

        const orderedHandleEnds = asc(this._handleEnds.slice());

        setLabel.call(this, 0);
        setLabel.call(this, 1);

        function setLabel(this: SliderZoomView, handleIndex: 0 | 1) {
            // Label
            // Text should not transform by barGroup.
            // Ignore handlers transform
            const barTransform = graphic.getTransform(
                displaybles.handles[handleIndex].parent, this.group
            );
            const direction = graphic.transformDirection(
                handleIndex === 0 ? 'right' : 'left', barTransform
            );
            const offset = this._handleWidth / 2 + LABEL_GAP;
            const textPoint = graphic.applyTransform(
                [
                    orderedHandleEnds[handleIndex] + (handleIndex === 0 ? -offset : offset),
                    this._size[1] / 2
                ],
                barTransform
            );
            handleLabels[handleIndex].setStyle({
                x: textPoint[0],
                y: textPoint[1],
                verticalAlign: orient === HORIZONTAL ? 'middle' : direction as ZRTextVerticalAlign,
                align: orient === HORIZONTAL ? direction as ZRTextAlign : 'center',
                text: labelTexts[handleIndex]
            });
        }
    }

    private _formatLabel(value: ParsedValue, axis: Axis) {
        const dataZoomModel = this.dataZoomModel;
        const labelFormatter = dataZoomModel.get('labelFormatter');

        let labelPrecision = dataZoomModel.get('labelPrecision');
        if (labelPrecision == null || labelPrecision === 'auto') {
            labelPrecision = axis.getPixelPrecision();
        }

        const valueStr = (value == null || isNaN(value as number))
            ? ''
            // FIXME Glue code
            : (axis.type === 'category' || axis.type === 'time')
                ? axis.scale.getLabel({
                    value: Math.round(value as number)
                })
                // param of toFixed should less then 20.
                : (value as number).toFixed(Math.min(labelPrecision as number, 20));

        return isFunction(labelFormatter)
            ? labelFormatter(value as number, valueStr)
            : isString(labelFormatter)
                ? labelFormatter.replace('{value}', valueStr)
                : valueStr;
    }

    /**
     * @param isEmphasis true: show, false: hide
     */
    private _showDataInfo(isEmphasis?: boolean) {
        const handleLabel = this.dataZoomModel.get('handleLabel') || {};
        const normalShow = handleLabel.show || false;
        const emphasisHandleLabel = this.dataZoomModel.getModel(['emphasis', 'handleLabel']);
        const emphasisShow = emphasisHandleLabel.get('show') || false;
        // Dragging is considered as emphasis, unless emphasisShow is false
        const toShow = (isEmphasis || this._dragging)
            ? emphasisShow
            : normalShow;
        const displayables = this._displayables;
        const handleLabels = displayables.handleLabels;
        handleLabels[0].attr('invisible', !toShow);
        handleLabels[1].attr('invisible', !toShow);

        // Highlight move handle
        displayables.moveHandle
            && this.api[toShow ? 'enterEmphasis' : 'leaveEmphasis'](displayables.moveHandle, 1);
    }

    private _onDragMove(handleIndex: 0 | 1 | 'all', dx: number, dy: number, event: ZRElementEvent) {
        this._dragging = true;

        // For mobile device, prevent screen slider on the button.
        eventTool.stop(event.event);

        // Transform dx, dy to bar coordination.
        const barTransform = this._displayables.sliderGroup.getLocalTransform();
        const vertex = graphic.applyTransform([dx, dy], barTransform, true);

        const changed = this._updateInterval(handleIndex, vertex[0]);

        const realtime = this.dataZoomModel.get('realtime');

        this._updateView(!realtime);

        // Avoid dispatch dataZoom repeatly but range not changed,
        // which cause bad visual effect when progressive enabled.
        changed && realtime && this._dispatchZoomAction(true);
    }

    private _onDragEnd() {
        this._dragging = false;
        this._showDataInfo(false);

        // While in realtime mode and stream mode, dispatch action when
        // drag end will cause the whole view rerender, which is unnecessary.
        const realtime = this.dataZoomModel.get('realtime');
        !realtime && this._dispatchZoomAction(false);
    }

    private _onClickPanel(e: ZRElementEvent) {
        const size = this._size;
        const localPoint = this._displayables.sliderGroup.transformCoordToLocal(e.offsetX, e.offsetY);

        if (localPoint[0] < 0 || localPoint[0] > size[0]
            || localPoint[1] < 0 || localPoint[1] > size[1]
        ) {
            return;
        }

        const handleEnds = this._handleEnds;
        const center = (handleEnds[0] + handleEnds[1]) / 2;

        const changed = this._updateInterval('all', localPoint[0] - center);
        this._updateView();
        changed && this._dispatchZoomAction(false);
    }

    private _onBrushStart(e: ZRElementEvent) {
        const x = e.offsetX;
        const y = e.offsetY;
        this._brushStart = new graphic.Point(x, y);

        this._brushing = true;

        this._brushStartTime = +new Date();
        // this._updateBrushRect(x, y);
    }

    private _onBrushEnd(e: ZRElementEvent) {
        if (!this._brushing) {
            return;
        }

        const brushRect = this._displayables.brushRect;
        this._brushing = false;

        if (!brushRect) {
            return;
        }

        brushRect.attr('ignore', true);

        const brushShape = brushRect.shape;

        const brushEndTime = +new Date();
        // console.log(brushEndTime - this._brushStartTime);
        if (brushEndTime - this._brushStartTime < 200 && Math.abs(brushShape.width) < 5) {
            // Will treat it as a click
            return;
        }

        const viewExtend = this._getViewExtent();
        const percentExtent = [0, 100];

        const handleEnds = this._handleEnds = [brushShape.x, brushShape.x + brushShape.width];
        const minMaxSpan = this.dataZoomModel.findRepresentativeAxisProxy().getMinMaxSpan();
        // Restrict range.
        sliderMove(
            0,
            handleEnds,
            viewExtend,
            0,
            minMaxSpan.minSpan != null
                ? linearMap(minMaxSpan.minSpan, percentExtent, viewExtend, true) : null,
            minMaxSpan.maxSpan != null
                ? linearMap(minMaxSpan.maxSpan, percentExtent, viewExtend, true) : null
        );

        this._range = asc([
            linearMap(handleEnds[0], viewExtend, percentExtent, true),
            linearMap(handleEnds[1], viewExtend, percentExtent, true)
        ]);

        this._updateView();

        this._dispatchZoomAction(false);
    }

    private _onBrush(e: ZRElementEvent) {
        if (this._brushing) {
            // For mobile device, prevent screen slider on the button.
            eventTool.stop(e.event);

            this._updateBrushRect(e.offsetX, e.offsetY);
        }
    }

    private _updateBrushRect(mouseX: number, mouseY: number) {
        const displayables = this._displayables;
        const dataZoomModel = this.dataZoomModel;
        let brushRect = displayables.brushRect;
        if (!brushRect) {
            brushRect = displayables.brushRect = new Rect({
                silent: true,
                style: dataZoomModel.getModel('brushStyle').getItemStyle()
            });
            if (__EDITOR__) {
                addEditorInfo(brushRect, {
                    component: 'dataZoom',
                    element: 'brushRect'
                });
            }
            displayables.sliderGroup.add(brushRect);
        }

        brushRect.attr('ignore', false);

        const brushStart = this._brushStart;

        const sliderGroup = this._displayables.sliderGroup;

        const endPoint = sliderGroup.transformCoordToLocal(mouseX, mouseY);
        const startPoint = sliderGroup.transformCoordToLocal(brushStart.x, brushStart.y);

        const size = this._size;

        endPoint[0] = Math.max(Math.min(size[0], endPoint[0]), 0);

        brushRect.setShape({
            x: startPoint[0], y: 0,
            width: endPoint[0] - startPoint[0], height: size[1]
        });
    }

    /**
     * This action will be throttled.
     */
    _dispatchZoomAction(realtime: boolean) {
        const range = this._range;

        this.api.dispatchAction({
            type: 'dataZoom',
            from: this.uid,
            dataZoomId: this.dataZoomModel.id,
            animation: realtime ? REALTIME_ANIMATION_CONFIG : null,
            start: range[0],
            end: range[1]
        });
    }

    private _findCoordRect() {
        // Find the grid corresponding to the first axis referred by dataZoom.
        let rect: RectLike;
        const coordSysInfoList = collectReferCoordSysModelInfo(this.dataZoomModel).infoList;

        if (!rect && coordSysInfoList.length) {
            const coordSys = coordSysInfoList[0].model.coordinateSystem;
            rect = coordSys.getRect && coordSys.getRect();
        }

        if (!rect) {
            const width = this.api.getWidth();
            const height = this.api.getHeight();
            rect = {
                x: width * 0.2,
                y: height * 0.2,
                width: width * 0.6,
                height: height * 0.6
            };
        }

        return rect;
    }

}

function getOtherDim(thisDim: 'x' | 'y' | 'radius' | 'angle' | 'single' | 'z') {
    // FIXME
    // 这个逻辑和getOtherAxis里一致，但是写在这里是否不好
    const map = { x: 'y', y: 'x', radius: 'angle', angle: 'radius' };
    return map[thisDim as 'x' | 'y' | 'radius' | 'angle'];
}

function getCursor(orient: LayoutOrient) {
    return orient === 'vertical' ? 'ns-resize' : 'ew-resize';
}

export default SliderZoomView;
